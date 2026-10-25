import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import { serializeHandCards, revealHandPotAllocations, HandResultError } from '../hand-result-pots';
import { validateBettingAction } from '../poker-betting-rules';
import { calculateHandPots, distributeTiedPot, PokerPotError } from '../poker-pot-accounting';
import {auditHandStacks,StackAuditError} from '../poker-stack-audit';
import {validateHandStartLayout} from '../hand-start-layout';

const hands = new Hono<{ Bindings: Env }>();

const legalStreets = new Set(['pre', 'flop', 'turn', 'river']);
const legalActions = new Set(['post', 'straddle', 'fold', 'check', 'call', 'bet', 'raise', 'allin']);
// Pre-1 Oct 2026 hands with prior actions cannot gain truthful opening stacks.
// Such histories can finish under legacy betting rules; future hands still
// require host-confirmed balances before the first action.
const LEGACY_HAND_CUTOFF_UNIX=1790812800;
function legacyUnverifiedHand(createdAt:unknown,actionCount:number,confirmedCount:number):boolean{
  return Number.isSafeInteger(createdAt)&&Number(createdAt)<LEGACY_HAND_CUTOFF_UNIX&&
    actionCount>0&&confirmedCount===0;
}

function isLocked(game: {status?:string}): boolean {
  return game.status === 'settled' || game.status === 'cancelled';
}

const lockedMessage = 'Hand history is locked on settled or cancelled games';

// ── Helper: get game and verify cohost ──────────────────────────────────────
async function getGameAndVerify(c: any, gameId: string) {
  try {
    const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first() as any;
    if (!game) return null;
    const ok = await requireEventRole(c, game.event_id, 'cohost');
    if (!ok) return null;
    return game;
  } catch(e: any) {
    console.error('getGameAndVerify error:', e?.message);
    return null;
  }
}

async function verifyHandInGame(c: any, gameId: string, handId: string): Promise<boolean> {
  const hand = await c.env.DB.prepare('SELECT id FROM hands WHERE id=? AND game_id=?').bind(handId, gameId).first();
  return !!hand;
}

async function hasDeclaredWinner(c: any, handId: string): Promise<boolean> {
  const result = await c.env.DB.prepare('SELECT id FROM hand_results WHERE hand_id=?')
    .bind(handId).first();
  return !!result;
}

// ── Toggle hand tracking on/off ─────────────────────────────────────────────
hands.post('/games/:id/tracking/toggle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  const newVal = game.hand_tracking ? 0 : 1;
  await c.env.DB.prepare('UPDATE games SET hand_tracking=? WHERE id=?').bind(newVal, gameId).run();
  return c.json({ ok: true, hand_tracking: newVal });
});

// ── Start a new hand ────────────────────────────────────────────────────────
hands.post('/games/:id/hands', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  const input=await c.req.json().catch(()=>null) as {
    dealer_seat?:unknown;sb_seat?:unknown;bb_seat?:unknown;
    straddle?:unknown;mode?:unknown
  }|null;
  const dealer=input?.dealer_seat,small=input?.sb_seat,big=input?.bb_seat;
  const mode=input?.mode==='manual'?'manual':input?.mode===undefined||
    input?.mode==='full'?'full':null;
  const inRange=(seat:unknown)=>Number.isSafeInteger(seat)&&
    Number(seat)>=1&&Number(seat)<=game.seats;
  if(!mode||!inRange(dealer)||!inRange(big)||!inRange(small)){
    return c.json({error:'Select valid dealer, small blind and big blind seats.'},400);
  }
  if(big===small||dealer===big)
    return c.json({error:'Blind seats cannot duplicate the dealer or one another.'},400);
  const straddle=input?.straddle??0;
  if(straddle!==0&&straddle!==1&&straddle!==true&&straddle!==false)
    return c.json({error:'Straddle must be 0 or 1.'},400);
  let registeredSeats:Array<{user_id:string;display_name:string;seat_number:number}>=[];
  if(mode==='full'){
    if(game.status!=='active')
      return c.json({error:'Start the game before recording a full hand.',
        code:'GAME_NOT_ACTIVE'},409);
    const roster=(await c.env.DB.prepare(
      'SELECT user_id,display_name,seat_number FROM game_players '+
      'WHERE game_id=? AND seat_number IS NOT NULL AND buy_ins>0'
    ).bind(gameId).all<{
      user_id:string;display_name:string;seat_number:number
    }>()).results;
    const decision=validateHandStartLayout(game.seats,roster,{
      dealer_seat:dealer as number,sb_seat:small as number,
      bb_seat:big as number,straddle:Boolean(straddle),
    });
    if(!decision.ok)return c.json({error:decision.error,code:decision.code},
      decision.code==='HAND_ROSTER_UNSYNCED'?409:400);
    registeredSeats=decision.seats;
  }
  const currentNo=game.current_hand_no||0;
  if(!Number.isSafeInteger(currentNo)||currentNo<0||currentNo>=1000000)
    return c.json({error:'Game hand counter needs review.'},409);
  const nextNo=currentNo+1;
  const id=generateId();
  // An unfinished non-voided hand must be resolved before the next one.
  // The conditional INSERT and matching game counter run in a single
  // D1 transaction; stale second hosts cannot start the same hand twice.
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO hands
      (id,game_id,hand_no,dealer_seat,sb_seat,bb_seat,straddle,board,pot_chips,mode)
      SELECT ?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS(
        SELECT 1 FROM games WHERE id=? AND current_hand_no=?
          AND status NOT IN ('settled','cancelled')
          AND (?='manual' OR status='active')
      )
      AND NOT EXISTS(
        SELECT 1 FROM hands h WHERE h.game_id=? AND h.voided=0
          AND NOT EXISTS(SELECT 1 FROM hand_results r WHERE r.hand_id=h.id)
      )
      -- Recheck exactly the same seated player IDs, names and physical seats
      -- inside the write. Same-count seat swaps must fail, not silently start.
      AND (?='manual' OR (
        (SELECT COUNT(*) FROM game_players WHERE game_id=?
          AND seat_number IS NOT NULL AND buy_ins>0)=?
        AND NOT EXISTS(
          SELECT 1 FROM json_each(?) observed
          WHERE NOT EXISTS(
            SELECT 1 FROM game_players gp WHERE gp.game_id=?
              AND gp.user_id=json_extract(observed.value,'$.user_id')
              AND gp.display_name=json_extract(observed.value,'$.display_name')
              AND gp.seat_number=json_extract(observed.value,'$.seat_number')
              AND gp.buy_ins>0
          )
        )
      ))
      ON CONFLICT(game_id,hand_no) DO NOTHING
    `).bind(id,gameId,nextNo,dealer,small,big,Boolean(straddle)?1:0,
      '[]',0,mode,gameId,currentNo,mode,gameId,mode,
      gameId,registeredSeats.length,JSON.stringify(registeredSeats),gameId),
    c.env.DB.prepare(`
      UPDATE games SET current_hand_no=?,current_dealer_seat=?
      WHERE id=? AND current_hand_no=? AND status NOT IN ('settled','cancelled')
      AND changes()=1
    `).bind(nextNo,dealer,gameId,currentNo),
  ]);
  if(!results[0]?.meta?.changes||!results[1]?.meta?.changes){
    return c.json({error:'Another host started a hand, or the previous hand is unfinished. Refresh the hand tracker.',
      code:'HAND_START_CONFLICT'},409);
  }
  const hand=await c.env.DB.prepare('SELECT * FROM hands WHERE id=?').bind(id).first();
  return c.json(hand,201);
});

// The host sees authoritative seat identities but must physically count chips.
// Do not read optional migration tables when integrity mode is disabled.
hands.get('/games/:id/hands/:handId/stack-baseline',authMiddleware,async(c)=>{
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  const hand=await c.env.DB.prepare(
    'SELECT id,mode,voided,created_at FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<{id:string;mode:string;voided:number;created_at:number}>();
  if(!hand)return c.json({error:'Hand not found'},404);
  if(c.env.PKR_INTEGRITY_STACKS!=='1')
    return c.json({enabled:false,confirmed:false,players:[]});
  const saved=(await c.env.DB.prepare(
    'SELECT user_id,display_name,seat_number,opening_chips FROM hand_stack_baselines WHERE hand_id=? ORDER BY seat_number'
  ).bind(handId).all<{user_id:string;display_name:string;seat_number:number;opening_chips:number}>()).results;
  if(saved.length)return c.json({enabled:true,confirmed:true,players:saved});
  if(hand.mode!=='full'||hand.voided||game.status!=='active')
    return c.json({error:'Opening stacks can only be confirmed for an active full hand.',
      code:'STACK_BASELINE_UNAVAILABLE'},409);
  const roster=(await c.env.DB.prepare(
    'SELECT user_id,display_name,seat_number FROM game_players '+
    'WHERE game_id=? AND seat_number IS NOT NULL AND buy_ins>0 ORDER BY seat_number'
  ).bind(gameId).all<{user_id:string;display_name:string;seat_number:number}>()).results;
  if(roster.length<2||roster.length>50)
    return c.json({error:'At least two registered seated players are required.',
      code:'STACK_BASELINE_UNAVAILABLE'},409);
  const actions=await c.env.DB.prepare(
    'SELECT id FROM hand_actions WHERE hand_id=? LIMIT 1'
  ).bind(handId).first<{id:string}>();
  if(actions&&legacyUnverifiedHand(hand.created_at,1,0))
    return c.json({enabled:false,confirmed:false,legacy_unverified:true,players:[],
      warning:'Pre-rollout hand with actions: opening chips cannot be certified retrospectively.'});
  if(actions)return c.json({error:'Opening stacks must be confirmed before betting.',
    code:'STACK_BASELINE_CONFLICT'},409);
  return c.json({enabled:true,confirmed:false,players:roster});
});

// ── Explicit, immutable opening stacks (optional integrity upgrade) ────────
hands.post('/games/:id/hands/:handId/confirm-stacks', authMiddleware, async (c) => {
  if(c.env.PKR_INTEGRITY_STACKS!=='1')
    return c.json({error:'Persistent stack baselines are not enabled.',
      code:'STACK_BASELINE_UNAVAILABLE'},503);
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  const hand=await c.env.DB.prepare(
    'SELECT id,mode,voided FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<{id:string;mode:string;voided:number}>();
  if(!hand)return c.json({error:'Hand not found'},404);
  if(hand.mode!=='full'||hand.voided||game.status!=='active')
    return c.json({error:'Only an active full hand can confirm opening stacks.'},409);
  const input=await c.req.json().catch(()=>null) as {
    verified?:unknown;opening_stacks?:unknown
  }|null;
  if(input?.verified!==true||!Array.isArray(input.opening_stacks))
    return c.json({error:'Host verification of every opening stack is required.'},400);
  const roster=(await c.env.DB.prepare(
    'SELECT user_id,display_name,seat_number FROM game_players '+
    'WHERE game_id=? AND seat_number IS NOT NULL AND buy_ins>0'
  ).bind(gameId).all<{
    user_id:string;display_name:string;seat_number:number
  }>()).results;
  const supplied=input.opening_stacks as Array<Record<string,unknown>>;
  const ids=new Set<string>(),seats=new Set<number>();
  if(roster.length<2||supplied.length!==roster.length||supplied.length>50)
    return c.json({error:'Confirm every registered seated player exactly once.'},400);
  for(const row of supplied){
    if(!row||typeof row.user_id!=='string'||typeof row.display_name!=='string'||
      !Number.isSafeInteger(row.seat_number)||!Number.isSafeInteger(row.opening_chips)||
      Number(row.opening_chips)<=0||ids.has(row.user_id)||
      seats.has(row.seat_number as number)||
      !roster.some(p=>p.user_id===row.user_id&&p.display_name===row.display_name&&
        p.seat_number===row.seat_number)){
      return c.json({error:'Opening balances must match unique registered seat identities.'},400);
    }
    ids.add(row.user_id);seats.add(row.seat_number as number);
  }
  const clean=supplied.map(row=>({
    user_id:row.user_id,display_name:row.display_name,
    seat_number:row.seat_number,opening_chips:row.opening_chips,
  }));
  const json=JSON.stringify(clean);
  // ONE insert-select statement: it either writes the entire confirmed
  // roster or no rows. It rechecks roster, hand, game and absence of history
  // inside the D1 write, preventing partial snapshots and racing actions.
  const result=await c.env.DB.prepare(`
    INSERT INTO hand_stack_baselines(
      hand_id,game_id,user_id,display_name,seat_number,opening_chips,verified_by
    )
    SELECT ?,?,
      json_extract(j.value,'$.user_id'),json_extract(j.value,'$.display_name'),
      json_extract(j.value,'$.seat_number'),json_extract(j.value,'$.opening_chips'),?
    FROM json_each(?) j
    WHERE (SELECT COUNT(*) FROM game_players
      WHERE game_id=? AND seat_number IS NOT NULL AND buy_ins>0)=?
    AND NOT EXISTS(
      SELECT 1 FROM json_each(?) v WHERE NOT EXISTS(
        SELECT 1 FROM game_players gp WHERE gp.game_id=?
          AND gp.user_id=json_extract(v.value,'$.user_id')
          AND gp.display_name=json_extract(v.value,'$.display_name')
          AND gp.seat_number=json_extract(v.value,'$.seat_number')
          AND gp.buy_ins>0
      )
    )
    AND NOT EXISTS(SELECT 1 FROM hand_stack_baselines WHERE hand_id=?)
    AND NOT EXISTS(SELECT 1 FROM hand_actions WHERE hand_id=?)
    AND NOT EXISTS(SELECT 1 FROM hand_results WHERE hand_id=?)
    AND EXISTS(SELECT 1 FROM hands WHERE id=? AND game_id=? AND mode='full' AND voided=0)
    AND EXISTS(SELECT 1 FROM games WHERE id=? AND status='active')
  `).bind(handId,gameId,c.get('userId'),json,
    gameId,clean.length,json,gameId,handId,handId,handId,
    handId,gameId,gameId).run();
  if(result.meta.changes!==clean.length)
    return c.json({
      error:'Opening stacks were already confirmed or the roster changed. Reload before retrying.',
      code:'STACK_BASELINE_CONFLICT',
    },409);
  return c.json({ok:true,confirmed:true,players:clean.length});
});

// ── Read-only audit from host-confirmed opening chips; never guesses stacks ─
hands.post('/games/:id/hands/:handId/audit-stacks', authMiddleware, async (c) => {
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  const hand=await c.env.DB.prepare(
    'SELECT * FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<any>();
  if(!hand)return c.json({error:'Hand not found'},404);
  if(hand.voided)return c.json({error:'Voided hands cannot be used as live stack baselines.'},409);
  const body=await c.req.json().catch(()=>null) as {opening_stacks?:unknown}|null;
  let opening:Parameters<typeof auditHandStacks>[0];
  if(c.env.PKR_INTEGRITY_STACKS==='1'){
    // In integrity mode the *persisted* baseline is the authority. Caller
    // cannot substitute invented balances in an audit request.
    opening=(await c.env.DB.prepare(
      'SELECT display_name,seat_number,opening_chips FROM hand_stack_baselines WHERE hand_id=?'
    ).bind(handId).all<{
      display_name:string;seat_number:number;opening_chips:number
    }>()).results;
    if(opening.length<2)
      return c.json({error:'Opening stacks have not been confirmed.',
        code:'STACK_BASELINE_REQUIRED'},428);
  }else{
    if(!Array.isArray(body?.opening_stacks))
      return c.json({error:'Provide physically counted opening chips for each player.'},400);
    opening=body.opening_stacks as Parameters<typeof auditHandStacks>[0];
  }
  const actions=(await c.env.DB.prepare(
    'SELECT display_name,action,chips FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
  ).bind(handId).all<{display_name:string;action:string;chips:number}>()).results;
  const savedResult=await c.env.DB.prepare(
    'SELECT * FROM hand_results WHERE hand_id=?'
  ).bind(handId).first<any>();
  const revealed=revealHandPotAllocations(savedResult) as any;
  try{
    const audit=auditHandStacks(opening,actions,
      revealed?{
        pot_winners:revealed.pot_winners||[],
        uncalled_returns:revealed.uncalled_returns||[],
      }:null,
      hand.dealer_seat,game.seats);
    if(audit.recorded_pot_chips!==hand.pot_chips)
      return c.json({
        error:'Recorded action contributions do not equal the saved pot.',
        code:'STACK_AUDIT_FAILED',
      },409);
    return c.json({ok:true,verified_input_only:c.env.PKR_INTEGRITY_STACKS!=='1',
      persisted_baseline:c.env.PKR_INTEGRITY_STACKS==='1',audit});
  }catch(err){
    if(err instanceof StackAuditError)return c.json({
      error:err.message,code:'STACK_AUDIT_FAILED',
    },409);
    throw err;
  }
});

// ── Get all hands for a game ─────────────────────────────────────────────────
hands.get('/games/:id/hands', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id FROM games WHERE id=?').bind(gameId).first() as any;
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);

  const handRows = await c.env.DB.prepare('SELECT * FROM hands WHERE game_id=? ORDER BY hand_no DESC').bind(gameId).all<any>();
  const results: any[] = [];
  for (const h of handRows.results) {
    const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at, rowid').bind(h.id).all<any>();
    const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(h.id).first() as any;
    results.push({ ...h, board: JSON.parse(h.board || '[]'), actions: actions.results, result:revealHandPotAllocations(result) });
  }
  return c.json(results);
});

// ── Get single hand ──────────────────────────────────────────────────────────
hands.get('/games/:id/hands/:handId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await c.env.DB.prepare('SELECT event_id FROM games WHERE id=?').bind(gameId).first() as any;
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=? AND game_id=?').bind(handId, gameId).first() as any;
  if (!hand) return c.json({ error: 'Hand not found' }, 404);
  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at, rowid').bind(handId).all<any>();
  const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(handId).first() as any;
  return c.json({ ...hand, board: JSON.parse(hand.board || '[]'), actions: actions.results, result:revealHandPotAllocations(result) });
});

// ── Update board cards, rejecting stale edits and finished hands ──────────────
hands.put('/games/:id/hands/:handId/board', authMiddleware, async (c) => {
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  if(!await verifyHandInGame(c,gameId,handId))
    return c.json({error:'Hand not found in this game'},404);
  const input=await c.req.json().catch(()=>null) as {
    board?:unknown;expected_board?:unknown
  }|null;
  if(!input||!Object.prototype.hasOwnProperty.call(input,'expected_board'))
    return c.json({
      error:'Original board cards are required. Reload before changing cards.',
      code:'PRECONDITION_REQUIRED',
    },428);
  const valid=(cards:unknown):cards is string[]=>
    Array.isArray(cards)&&cards.length<=5&&
    cards.every(card=>typeof card==='string'&&/^[2-9TJQKA][♠♥♦♣]$/.test(card))&&
    new Set(cards).size===cards.length;
  if(!valid(input.board)||!valid(input.expected_board))
    return c.json({error:'Board and original board must contain unique valid cards.'},400);
  const wanted=JSON.stringify(input.board),original=JSON.stringify(input.expected_board);
  // Both winner and game status are checked in the SAME conditional SQL write.
  const update=await c.env.DB.prepare(`
    UPDATE hands SET board=? WHERE id=? AND game_id=? AND board=? AND voided=0
    AND NOT EXISTS (SELECT 1 FROM hand_results WHERE hand_id=?)
    AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
  `).bind(wanted,handId,gameId,original,handId,gameId).run();
  if(!update.meta.changes){
    const saved=await c.env.DB.prepare(
      'SELECT board,voided FROM hands WHERE id=? AND game_id=?'
    ).bind(handId,gameId).first<{board:string;voided:number}>();
    if(!saved)return c.json({error:'Hand not found in game'},404);
    return c.json({
      error:'Another host changed the board, or the hand was finished or voided. Reload the saved hand.',
      code:'BOARD_CONFLICT',current_board:JSON.parse(saved.board||'[]'),
    },409);
  }
  return c.json({ok:true,board:input.board});
});

// ── Record a player action ───────────────────────────────────────────────────
hands.post('/games/:id/hands/:handId/actions', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  if (!await verifyHandInGame(c, gameId, handId)) return c.json({ error: 'Hand not found in this game' }, 404);
  if (await hasDeclaredWinner(c, handId)) return c.json({ error: 'Hand has a declared winner. Undo the winner first.' }, 409);

  const input = await c.req.json().catch(() => null) as {
    user_id?:unknown;display_name?:unknown;street?:unknown;action?:unknown;chips?:unknown
  } | null;
  const display_name = typeof input?.display_name === 'string' ? input.display_name.trim() : '';
  const street = input?.street;
  const action = input?.action;
  const chips = input?.chips === undefined ? 0 : input.chips;
  if (!display_name || display_name.length > 120 ||
      typeof street !== 'string' || !legalStreets.has(street) ||
      typeof action !== 'string' || !legalActions.has(action)) {
    return c.json({ error: 'Invalid player, street, or action' }, 400);
  }
  if (!Number.isSafeInteger(chips) || (chips as number) < 0 ||
      (['fold','check'].includes(action) && chips !== 0) ||
      (!['fold','check'].includes(action) && (chips as number) === 0)) {
    return c.json({ error: 'Action chips must be a valid nonnegative integer, with zero for fold/check' }, 400);
  }
  const user_id = typeof input?.user_id === 'string' ? input.user_id : null;

  // The action IDs and betting history MUST come from the same snapshot.
  // A separate last-action lookup after validation would let a simultaneous
  // second host advance the log between those reads.
  const historyRows=(await c.env.DB.prepare(
    'SELECT id,display_name,street,action,chips FROM hand_actions '+
    'WHERE hand_id=? ORDER BY created_at,rowid'
  ).bind(handId).all<{
    id:string;display_name:string;street:string;action:string;chips:number
  }>()).results;

  // Validate complete full-hand betting history from the server, rather than
  // trusting the browser's predicted actor or submitted chip amounts.
  // Remaining stacks cannot be certified without a server chip-stack ledger.
  const handMeta=await c.env.DB.prepare(
    'SELECT dealer_seat,sb_seat,bb_seat,straddle,mode,created_at FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<{
    dealer_seat:number|null;sb_seat:number|null;bb_seat:number|null;
    straddle:number|null;mode:string;created_at:number
  }>();
  if(handMeta?.mode==='full'){
    if(!Number.isSafeInteger(handMeta.dealer_seat)||!Number.isSafeInteger(handMeta.bb_seat)){
      return c.json({error:'Dealer/blind positions are missing from this hand.',
        code:'BETTING_STATE_UNAVAILABLE'},409);
    }
    const roster=(await c.env.DB.prepare(
      'SELECT user_id,display_name,seat_number FROM game_players '+
      'WHERE game_id=? AND seat_number IS NOT NULL AND buy_ins>0 ORDER BY seat_number'
    ).bind(gameId).all<{user_id:string;display_name:string;seat_number:number}>()).results;
    if(roster.length<2){
      return c.json({error:'At least two seated players with recorded buy-ins are required.',
        code:'BETTING_STATE_UNAVAILABLE'},409);
    }
    const matching=roster.find(p=>p.display_name===display_name);
    if(user_id&&matching&&matching.user_id!==user_id)
      return c.json({error:'Player identity does not match the seat.',
        code:'INVALID_PLAYER_IDENTITY'},409);
    const decision=validateBettingAction({
      seats:game.seats,
      players:roster,
      hand:{
        dealer_seat:handMeta.dealer_seat as number,
        sb_seat:handMeta.sb_seat,
        bb_seat:handMeta.bb_seat as number,
        straddle:handMeta.straddle,
      },
      actions:historyRows,
      proposed:{display_name,street,action,chips:chips as number},
    });
    if(!decision.ok){
      return c.json({
        error:decision.error,code:decision.code,
        ...(decision.nextActor===undefined?{}:{next_actor:decision.nextActor}),
        ...(decision.toCall===undefined?{}:{to_call:decision.toCall}),
        ...(decision.minimumRaise===undefined?{}:{minimum_raise:decision.minimumRaise}),
      },409);
    }
    if(c.env.PKR_INTEGRITY_STACKS==='1'){
      const confirmed=(await c.env.DB.prepare(
        'SELECT user_id,display_name,seat_number,opening_chips FROM hand_stack_baselines WHERE hand_id=?'
      ).bind(handId).all<{
        user_id:string;display_name:string;seat_number:number;opening_chips:number
      }>()).results;
      // Preserve pre-cutoff hand histories already in progress; never invent chips.
      const legacy=legacyUnverifiedHand(handMeta.created_at,historyRows.length,confirmed.length);
      if(!legacy&&(confirmed.length!==roster.length||
         !roster.every(p=>confirmed.some(row=>row.user_id===p.user_id&&
           row.display_name===p.display_name&&row.seat_number===p.seat_number)))){
        return c.json({
          error:'Host-confirmed opening stacks are required for every active player.',
          code:'STACK_BASELINE_REQUIRED',
        },428);
      }
      if(!legacy){
        try{
          auditHandStacks(
            confirmed,
            historyRows.concat([{id:'pending',display_name,street,action,
              chips:chips as number}]),
            null,handMeta.dealer_seat as number,game.seats,
          );
        }catch(err){
          if(err instanceof StackAuditError)
            return c.json({error:err.message,code:'STACK_LIMIT_CONFLICT'},409);
          throw err;
        }
      }
    }
  }

  // Compare the previously observed last action within the INSERT itself:
  // two hosts cannot both append moves based on the same stale turn. Winner
  // publication and game closure are also checked inside the write.
  const expectedLastActionId=historyRows.length?historyRows[historyRows.length-1].id:null;
  const id=generateId();
  const outcome=await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO hand_actions(id,hand_id,game_id,user_id,display_name,street,action,chips)
      SELECT ?,?,?,?,?,?,?,? WHERE
      EXISTS (SELECT 1 FROM hands WHERE id=? AND game_id=? AND voided=0)
      AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
      AND NOT EXISTS (SELECT 1 FROM hand_results WHERE hand_id=?)
      AND (SELECT id FROM hand_actions WHERE hand_id=?
        ORDER BY created_at DESC,rowid DESC LIMIT 1) IS ?
    `).bind(id,handId,gameId,user_id,display_name,street,action,chips,
      handId,gameId,gameId,handId,handId,expectedLastActionId),
    c.env.DB.prepare(`UPDATE hands SET pot_chips=(
      SELECT COALESCE(SUM(CASE WHEN action <> 'fold' AND chips > 0 THEN chips ELSE 0 END),0)
      FROM hand_actions WHERE hand_id=?
    ) WHERE id=? AND game_id=?`).bind(handId,handId,gameId),
  ]);
  if(!outcome[0]?.meta?.changes){
    return c.json({
      error:'Another host changed this hand, or the game was closed. Reload before retrying.',
      code:'HAND_ACTION_CONFLICT',
    },409);
  }
  const actions=await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
  ).bind(handId).all();
  const hand=await c.env.DB.prepare(
    'SELECT pot_chips FROM hands WHERE id=?'
  ).bind(handId).first<{pot_chips:number}>();
  return c.json({ok:true,actions:actions.results,pot_chips:hand?.pot_chips||0});
});

// ── Delete the observed last action, never a different newer action ───────
hands.delete('/games/:id/hands/:handId/actions/last', authMiddleware, async (c) => {
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  if(!await verifyHandInGame(c,gameId,handId))
    return c.json({error:'Hand not found in game'},404);
  const body=await c.req.json().catch(()=>null) as {expected_action_id?:unknown}|null;
  if(typeof body?.expected_action_id!=='string'||!body.expected_action_id)
    return c.json({error:'Original action ID required before undo.',
      code:'PRECONDITION_REQUIRED'},428);
  const result=await c.env.DB.batch([
    c.env.DB.prepare(`
      DELETE FROM hand_actions
      WHERE id=? AND hand_id=? AND game_id=?
      AND id=(SELECT id FROM hand_actions WHERE hand_id=?
        ORDER BY created_at DESC,rowid DESC LIMIT 1)
      AND EXISTS(SELECT 1 FROM hands WHERE id=? AND game_id=? AND voided=0)
      AND EXISTS(SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
      AND NOT EXISTS(SELECT 1 FROM hand_results WHERE hand_id=?)
    `).bind(body.expected_action_id,handId,gameId,handId,
      handId,gameId,gameId,handId),
    c.env.DB.prepare(`
      UPDATE hands SET pot_chips=(
        SELECT COALESCE(SUM(CASE WHEN action <> 'fold' AND chips>0 THEN chips ELSE 0 END),0)
        FROM hand_actions WHERE hand_id=?
      ) WHERE id=? AND game_id=? AND voided=0
    `).bind(handId,handId,gameId),
  ]);
  if(!result[0]?.meta?.changes)
    return c.json({error:'This action is no longer the last recorded move. Reload before undo.',
      code:'HAND_ACTION_CONFLICT'},409);
  const actions=await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
  ).bind(handId).all();
  const hand=await c.env.DB.prepare(
    'SELECT pot_chips FROM hands WHERE id=?'
  ).bind(handId).first<{pot_chips:number}>();
  return c.json({ok:true,actions:actions.results,pot_chips:hand?.pot_chips||0});
});

// ── Declare winner ───────────────────────────────────────────────────────────
hands.post('/games/:id/hands/:handId/result', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  if (!await verifyHandInGame(c, gameId, handId)) return c.json({ error: 'Hand not found in this game' }, 404);

  const { winner_user_id, winner_name, hole_cards, split_pot, pot_winners } = await c.req.json();
  if (typeof winner_name!=='string' || !winner_name.trim() || winner_name.trim().length>120)
    return c.json({error:'A valid winner name is required'},400);

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=? AND game_id=?').bind(handId, gameId).first() as any;
  if (!hand) return c.json({ error: 'Hand not found' }, 404);

  let storedCards:string;
  let expectedLastActionId:string|null=null;
  try {
    let allocations=pot_winners;
    let refunds:Array<{display_name:string;chips:number}>=[];
    // For complete hands, the server derives the contestable pots and
    // unmatched refunds from recorded actions. Client chip totals alone are
    // not authority and cannot assign an opponent's uncalled wager to a pot.
    if(hand.mode==='full'&&hand.pot_chips>0){
      const history=(await c.env.DB.prepare(
        'SELECT id,display_name,action,chips FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
      ).bind(handId).all<{id:string;display_name:string;action:string;chips:number}>()).results;
      expectedLastActionId=history.length?history[history.length-1].id:null;
      const roster=(await c.env.DB.prepare(
        'SELECT display_name,seat_number FROM game_players WHERE game_id=? AND seat_number IS NOT NULL'
      ).bind(gameId).all<{display_name:string;seat_number:number}>()).results;
      let accounting;
      try {
        accounting=calculateHandPots(history,roster);
      } catch(err){
        if(err instanceof PokerPotError)return c.json({
          error:'Cannot reconcile the recorded pot: '+err.message,
          code:'POT_RECONCILIATION_REQUIRED',
        },409);
        throw err;
      }
      if(accounting.grossChips!==hand.pot_chips || !accounting.pots.length){
        return c.json({
          error:'Recorded action chips do not reconcile to the hand pot.',
          code:'POT_RECONCILIATION_REQUIRED',
        },409);
      }
      refunds=accounting.uncalledReturns;
      if(allocations===undefined && accounting.pots.length===1){
        const single=accounting.pots[0];
        allocations=[{potIdx:0,winnerName:winner_name.trim(),
          chips:single.chips,label:single.label}];
      }
      if(!Array.isArray(allocations)||allocations.length!==accounting.pots.length){
        return c.json({
          error:'Each contestable main or side pot needs one eligible winner.',
          code:'POT_ALLOCATION_INVALID',
        },422);
      }
      const calculated=[];
      for(let i=0;i<accounting.pots.length;i++){
        const pot=accounting.pots[i],row=allocations[i];
        if(!row||row.potIdx!==i||row.chips!==pot.chips){
          return c.json({
            error:'Pot allocations do not match the recorded chip totals.',
            code:'POT_ALLOCATION_INVALID',
          },422);
        }
        if(Array.isArray(row.split_winners)){
          const names=row.split_winners.map((item:any)=>item?.winnerName);
          if(names.length<2||!names.every((name:unknown)=>
               typeof name==='string'&&pot.eligible.includes(name))){
            return c.json({error:'Only eligible players can tie for this pot.',
              code:'POT_ALLOCATION_INVALID'},422);
          }
          let distributed;
          try{
            distributed=distributeTiedPot(pot,names,roster,
              hand.dealer_seat,game.seats);
          }catch(err){
            if(err instanceof PokerPotError)return c.json({
              error:err.message,code:'POT_ALLOCATION_INVALID',
            },422);
            throw err;
          }
          const savedShares=new Map(
            row.split_winners.map((item:any)=>[item.winnerName,item.chips])
          );
          if(distributed.some(item=>savedShares.get(item.display_name)!==item.chips))
            return c.json({
              error:'Tied-pot chip amounts do not follow the button odd-chip rule.',
              code:'POT_ALLOCATION_INVALID',
            },422);
          calculated.push({
            potIdx:i,winnerName:names.join(', '),chips:pot.chips,label:pot.label,
            split_winners:distributed.map(d=>({
              winnerName:d.display_name,chips:d.chips,
            })),
          });
        }else{
          if(!pot.eligible.includes(row.winnerName))
            return c.json({
              error:'The declared winner is not eligible for this pot.',
              code:'POT_ALLOCATION_INVALID',
            },422);
          calculated.push({
            potIdx:i,winnerName:row.winnerName,chips:pot.chips,label:pot.label,
          });
        }
      }
      allocations=calculated;
      const canonicalWinner=calculated.map(p=>p.winnerName).join(', ');
      if(winner_name.trim()!==canonicalWinner){
        return c.json({
          error:'Winner summary does not match the allocated main and side pots.',
          code:'POT_ALLOCATION_INVALID',
        },422);
      }
    }else{
      // For a legacy or zero-pot hand, the last action still needs a
      // conditional guard against zero-chip fold/check mutations.
      const last=await c.env.DB.prepare(
        'SELECT id FROM hand_actions WHERE hand_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1'
      ).bind(handId).first<{id:string}>();
      expectedLastActionId=last?.id||null;
    }
    storedCards=serializeHandCards(hole_cards,allocations,hand.pot_chips,refunds);
  } catch(e) {
    if (e instanceof HandResultError) return c.json({ error:e.message },422);
    throw e;
  }

  // Results are append-only until explicitly undone. A retry of the same
  // winner is accepted, but a competing host cannot overwrite the outcome.
  // Both game status and current pot are checked in the same D1 statement.
  const resultId=generateId();
  const winnerId=typeof winner_user_id==='string' && winner_user_id ? winner_user_id : null;
  const winner=winner_name.trim();
  const split=split_pot?1:0;
  const written=await c.env.DB.prepare(`
    INSERT INTO hand_results(id,hand_id,game_id,winner_user_id,winner_name,pot_chips,hole_cards,split_pot)
    SELECT ?,?,?,?,?,?,?,? WHERE
    EXISTS (SELECT 1 FROM hands WHERE id=? AND game_id=? AND pot_chips=? AND voided=0)
    AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
    AND (SELECT id FROM hand_actions WHERE hand_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1) IS ?
    ON CONFLICT(hand_id) DO NOTHING
  `).bind(resultId,handId,gameId,winnerId,winner,hand.pot_chips,storedCards,split,
    handId,gameId,hand.pot_chips,gameId,handId,expectedLastActionId).run();

  const result=await c.env.DB.prepare(
    'SELECT * FROM hand_results WHERE hand_id=?'
  ).bind(handId).first<any>();
  if(written.meta.changes===0){
    if(result){
      // One replayed response may arrive after a network interruption.
      const same=result.winner_user_id===winnerId &&
        result.winner_name===winner &&
        result.pot_chips===hand.pot_chips &&
        result.hole_cards===storedCards &&
        result.split_pot===split;
      if(same) return c.json({ok:true,already_applied:true,result:revealHandPotAllocations(result)});
      return c.json({
        error:'Another host has already declared the winner. Undo that result before making a correction.',
        code:'HAND_RESULT_CONFLICT',
      },409);
    }
    return c.json({
      error:'Hand pot or game status changed before the winner could be saved. Reload and review.',
      code:'HAND_STATE_CONFLICT',
    },409);
  }
  return c.json({ok:true,result:revealHandPotAllocations(result)});
});

// ── Update D/SB/BB assignments ──────────────────────────────────────────────────
hands.put('/games/:id/hands/:handId/assign', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  if (!await verifyHandInGame(c, gameId, handId)) return c.json({ error: 'Hand not found in this game' }, 404);
  if (await hasDeclaredWinner(c, handId)) return c.json({ error: 'Hand has a declared winner. Undo the winner first.' }, 409);

  const { dealer_seat, sb_seat, bb_seat } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE hands SET dealer_seat=COALESCE(?,dealer_seat), sb_seat=COALESCE(?,sb_seat), bb_seat=COALESCE(?,bb_seat) WHERE id=? AND game_id=?'
  ).bind(dealer_seat||null, sb_seat||null, bb_seat||null, handId, gameId).run();

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=?').bind(handId).first() as any;
  return c.json({ ...hand, board: JSON.parse(hand.board || '[]') });
});

// ── Void hand without destroying recorded evidence ───────────────────────
hands.delete('/games/:id/hands/:handId', authMiddleware, async (c) => {
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  const written=await c.env.DB.prepare(`
    UPDATE hands SET voided=1
    WHERE id=? AND game_id=? AND voided=0
    AND EXISTS(SELECT 1 FROM games
      WHERE id=? AND status NOT IN ('settled','cancelled'))
  `).bind(handId,gameId,gameId).run();
  if(!written.meta.changes){
    const hand=await c.env.DB.prepare(
      'SELECT voided FROM hands WHERE id=? AND game_id=?'
    ).bind(handId,gameId).first<{voided:number}>();
    if(!hand)return c.json({error:'Hand not found'},404);
    if(hand.voided)return c.json({ok:true,already_voided:true});
    return c.json({error:'Hand changed before it could be voided.',
      code:'HAND_STATE_CONFLICT'},409);
  }
  // Keep hands, actions and winner records for review. The hand counter
  // remains monotonic; never recycle an already recorded hand number.
  return c.json({ok:true,voided:true});
});

// ── Undo the specific winner result the host actually reviewed ────────────
hands.delete('/games/:id/hands/:handId/result', authMiddleware, async (c) => {
  const gameId=c.req.param('id'),handId=c.req.param('handId');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden or not found'},403);
  if(isLocked(game))return c.json({error:lockedMessage},409);
  const body=await c.req.json().catch(()=>null) as {expected_result_id?:unknown}|null;
  if(typeof body?.expected_result_id!=='string'||!body.expected_result_id)
    return c.json({error:'Original winner result ID required to undo.',
      code:'PRECONDITION_REQUIRED'},428);
  const removed=await c.env.DB.prepare(`
    DELETE FROM hand_results WHERE hand_id=? AND game_id=? AND id=?
    AND EXISTS(SELECT 1 FROM hands WHERE id=? AND game_id=? AND voided=0)
    AND EXISTS(SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
  `).bind(handId,gameId,body.expected_result_id,handId,gameId,gameId).run();
  if(!removed.meta.changes)return c.json({
    error:'Winner result changed on another device. Reload before undoing.',
    code:'HAND_RESULT_CONFLICT',
  },409);
  const hand=await c.env.DB.prepare(
    'SELECT * FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<any>();
  if(!hand)return c.json({error:'Hand not found'},404);
  const actions=await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
  ).bind(handId).all();
  return c.json({...hand,board:JSON.parse(hand.board||'[]'),actions:actions.results,result:null});
});

// ── Toggle live card submission ──────────────────────────────────────────────
hands.post('/games/:id/tracking/live-cards', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  const { enabled } = await c.req.json() as any;
  await c.env.DB.prepare('UPDATE games SET live_cards_enabled=? WHERE id=?').bind(enabled ? 1 : 0, gameId).run();
  return c.json({ live_cards_enabled: enabled ? 1 : 0 });
});


// ── Seat draw ────────────────────────────────────────────────────────────────
hands.post('/games/:id/seat-draw', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'cohost')) return c.json({ error: 'Forbidden' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  const { result } = await c.req.json() as any;
  await c.env.DB.prepare('UPDATE games SET seat_draw_result=? WHERE id=?')
    .bind(JSON.stringify(result || []), gameId).run();
  return c.json({ ok: true });
});

// ── Get live hand state (for player view polling) ────────────────────────────
hands.get('/games/live/:token/hand', async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare(
    'SELECT id,hand_tracking,current_hand_no,chip_value,starting_chips FROM games WHERE live_token=?'
  ).bind(token).first() as any;
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!game.hand_tracking) return c.json({ hand_tracking: false });

  // Get current (latest) hand
  const hand = await c.env.DB.prepare(
    'SELECT * FROM hands WHERE game_id=? AND voided=0 ORDER BY hand_no DESC LIMIT 1'
  ).bind(game.id).first() as any;
  if (!hand) return c.json({ hand_tracking: true, hand: null });

  const actions = await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at, rowid'
  ).bind(hand.id).all<any>();
  const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(hand.id).first() as any;

  return c.json({
    hand_tracking: true,
    chip_value: game.chip_value || 0,
    starting_chips: game.starting_chips || 0,
    hand: {
      ...hand,
      board: JSON.parse(hand.board || '[]'),
      actions: actions.results,
      result: revealHandPotAllocations(result) || null,
    },
  });
});

export default hands;
