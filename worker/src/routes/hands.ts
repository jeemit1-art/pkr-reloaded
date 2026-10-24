import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import { serializeHandCards, revealHandPotAllocations, HandResultError } from '../hand-result-pots';
import { validateBettingAction } from '../poker-betting-rules';
import { calculateHandPots, PokerPotError } from '../poker-pot-accounting';

const hands = new Hono<{ Bindings: Env }>();

const legalStreets = new Set(['pre', 'flop', 'turn', 'river']);
const legalActions = new Set(['post', 'straddle', 'fold', 'check', 'call', 'bet', 'raise', 'allin']);

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
      )
      AND NOT EXISTS(
        SELECT 1 FROM hands h WHERE h.game_id=? AND h.voided=0
          AND NOT EXISTS(SELECT 1 FROM hand_results r WHERE r.hand_id=h.id)
      )
      ON CONFLICT(game_id,hand_no) DO NOTHING
    `).bind(id,gameId,nextNo,dealer,small,big,input?.straddle?1:0,
      '[]',0,mode,gameId,currentNo,gameId),
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

// ── Update board cards ───────────────────────────────────────────────────────
hands.put('/games/:id/hands/:handId/board', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  if (isLocked(game)) return c.json({ error: lockedMessage }, 409);
  if (!await verifyHandInGame(c, gameId, handId)) return c.json({ error: 'Hand not found in this game' }, 404);
  if (await hasDeclaredWinner(c, handId)) return c.json({ error: 'Hand has a declared winner. Undo the winner first.' }, 409);

  const { board } = await c.req.json<{ board: string[] }>();
  if (!Array.isArray(board) || board.length > 5 || board.some(card => typeof card !== 'string' || !/^[2-9TJQKA][♠♥♦♣]$/.test(card)) || new Set(board).size !== board.length) return c.json({error:'Invalid board cards'},400);
  await c.env.DB.prepare('UPDATE hands SET board=? WHERE id=? AND game_id=?')
    .bind(JSON.stringify(board || []), handId, gameId).run();
  return c.json({ ok: true, board });
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
    'SELECT dealer_seat,sb_seat,bb_seat,straddle,mode FROM hands WHERE id=? AND game_id=?'
  ).bind(handId,gameId).first<{
    dealer_seat:number|null;sb_seat:number|null;bb_seat:number|null;
    straddle:number|null;mode:string
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
  try {
    let allocations=pot_winners;
    let refunds:Array<{display_name:string;chips:number}>=[];
    // For complete hands, the server derives the contestable pots and
    // unmatched refunds from recorded actions. Client chip totals alone are
    // not authority and cannot assign an opponent's uncalled wager to a pot.
    if(hand.mode==='full'&&hand.pot_chips>0){
      const history=(await c.env.DB.prepare(
        'SELECT display_name,action,chips FROM hand_actions WHERE hand_id=? ORDER BY created_at,rowid'
      ).bind(handId).all<{display_name:string;action:string;chips:number}>()).results;
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
      for(let i=0;i<accounting.pots.length;i++){
        const pot=accounting.pots[i];
        const row=allocations[i];
        if(!row||row.potIdx!==i||row.chips!==pot.chips||
           !pot.eligible.includes(row.winnerName)){
          return c.json({
            error:'Pot allocation does not match the eligible players and chip total.',
            code:'POT_ALLOCATION_INVALID',
          },422);
        }
      }
      allocations=accounting.pots.map((pot,i)=>({
        potIdx:i,winnerName:allocations[i].winnerName,
        chips:pot.chips,label:pot.label,
      }));
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
    ON CONFLICT(hand_id) DO NOTHING
  `).bind(resultId,handId,gameId,winnerId,winner,hand.pot_chips,storedCards,split,
    handId,gameId,hand.pot_chips,gameId).run();

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
