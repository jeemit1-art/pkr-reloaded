import { Hono } from 'hono';
import { Env, SettleRequest, Transfer } from '../types';
import { authMiddleware, optionalAuth, requireEventRole, generateId, getPlanStatus } from '../middleware';
import { sendPushToEvent, sendPushToPlayer } from '../push';
import { minimumTransfers, prepareSettlementPositions, SettlementValidationError } from '../settle';
import { clientSafeGame } from '../public-data';
import {planStartSeating, type ExistingGameSeat, type ConfirmedRsvp} from '../game-start-seating';

const games = new Hono<{ Bindings: Env }>();

// Revision enforcement remains disabled until the optional staging D1 migration
// and client retry handling are verified. Legacy mode never queries these tables.
const revisionMode=(env:Env)=>env.PKR_INTEGRITY_REVISIONS==='1';
async function getPlayers(db:D1Database,gameId:string,enabled:boolean){
  if(!enabled)return db.prepare(
    'SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC'
  ).bind(gameId).all<any>();
  return db.prepare(`
    SELECT gp.*,rev.revision FROM game_players gp
    LEFT JOIN game_player_revisions rev
      ON rev.game_id=gp.game_id AND rev.user_id=gp.user_id
    WHERE gp.game_id=?
    ORDER BY gp.seat_number ASC NULLS LAST,gp.created_at ASC
  `).bind(gameId).all<any>();
}


/* ═══════════════════════════════════════════
   CORE GAME CRUD
═══════════════════════════════════════════ */

games.get('/events/:eventId/games', authMiddleware, async (c) => {
  const eventId = c.req.param('eventId');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const { status } = c.req.query();
  let q = 'SELECT * FROM games WHERE event_id=?';
  const b: unknown[] = [eventId];
  if (status) { q+=' AND status=?'; b.push(status); }
  q+=' ORDER BY scheduled_at DESC';
  const rows = await c.env.DB.prepare(q).bind(...b).all();
  return c.json(rows.results.map(clientSafeGame));
});

games.post('/events/:eventId/games', authMiddleware, async (c) => {
  const eventId = c.req.param('eventId');
  if (!await requireEventRole(c,eventId,'cohost')) return c.json({error:'Forbidden'},403);
  const { scheduled_at, location, notes, seats, game_password } = await c.req.json();
  if (!scheduled_at) return c.json({error:'scheduled_at required'},400);

  // ── Plan gate: check seat limit ──────────────────────────────────────────
  const userId = c.get('userId');
  const planStatus = await getPlanStatus(c.env.DB, userId);

  if (!planStatus.is_active) {
    return c.json({
      error: 'Your free trial has ended. Upgrade to create new games.',
      code: 'UPGRADE_REQUIRED',
      plan: planStatus.plan,
      feature: 'create_game',
    }, 402);
  }

  const requestedSeats = seats || 9;
  if (requestedSeats > planStatus.max_seats) {
    return c.json({
      error: `Your plan supports up to ${planStatus.max_seats} seats. Upgrade to Pro for up to 15 seats.`,
      code: 'UPGRADE_REQUIRED',
      plan: planStatus.plan,
      feature: 'seat_limit',
      requested: requestedSeats,
      limit: planStatus.max_seats,
    }, 402);
  }
  // ─────────────────────────────────────────────────────────────────────────

  const id = generateId();
  const liveToken = generateId();
  await c.env.DB.prepare(
    'INSERT INTO games(id,event_id,scheduled_at,location,notes,seats,game_password,live_token,status) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind(id,eventId,scheduled_at,location||null,notes||null,requestedSeats,game_password||null,liveToken,'scheduled').run();

  const event = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(eventId).first<{name:string}>();
  const dt = new Date(scheduled_at*1000).toLocaleString('en-AU',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'});
  c.executionCtx.waitUntil(sendPushToEvent(c.env, eventId, {
    title:`🃏 ${event?.name||'PKR'} — Game Scheduled`,
    body:`${dt}${location?' · '+location:''}`,
    data:{ gameId:id, eventId, type:'game_scheduled', scheduled_at, location:location||null },
  }));
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(id).first();
  return c.json(game ? clientSafeGame(game) : null,201);
});

/* ── Get single game (with players + rsvps) ── */
games.get('/games/:id', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (!await requireEventRole(c,game.event_id,'member')) return c.json({error:'Forbidden'},403);
  const players = await getPlayers(c.env.DB,gameId,revisionMode(c.env));
  if(revisionMode(c.env)&&players.results.some(p=>!Number.isSafeInteger(p.revision)))
    return c.json({error:'Financial revision records are not initialised.',code:'REVISION_UNAVAILABLE'},503);
  const rsvps   = await c.env.DB.prepare('SELECT id,game_id,display_name,status,created_at FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC').bind(gameId).all();
  if(c.env.PKR_RSVP_V2==='1'){
    const arrivals=await c.env.DB.prepare(
      'SELECT id,game_id,display_name,status,arrival_option,seat_number,created_at,updated_at FROM game_rsvp_guests WHERE game_id=? ORDER BY created_at ASC'
    ).bind(gameId).all<any>();
    const names=new Set(arrivals.results.map(r=>r.display_name.toLowerCase()));
    rsvps.results=[...arrivals.results,...rsvps.results.filter((r:any)=>!names.has(r.display_name.toLowerCase()))];
  }
  const event   = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<any>();
  // If settled, attach transfers too
  const transfers = game.status==='settled'
    ? (await c.env.DB.prepare('SELECT * FROM settlement_transfers WHERE game_id=?').bind(gameId).all()).results
    : [];
  return c.json({...clientSafeGame(game), buy_in: event?.buy_in ?? 0, event_name: event?.name ?? '', players:players.results.map(({whatsapp,...safe}:any)=>safe), rsvps:rsvps.results, transfers});
});

/* ── Update game ── */
games.put('/games/:id', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status,scheduled_at,location FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled' || game.status==='cancelled') {
    return c.json({error:'Cannot modify a settled or cancelled game.'},409);
  }
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const { scheduled_at, location, notes, status, seats, game_password } = await c.req.json();
  // Status transitions must use start/cancel/settle/unsettle, not this generic edit route.
  if (status !== undefined) {
    return c.json({error:'Use the dedicated game action to change status'},400);
  }
  // Seat reductions must never orphan an occupied seat. Require the highest
  // numbered seat(s) to be vacant; retain stable seat numbers and player data.
  if (seats !== undefined && seats !== null) {
    if (!Number.isSafeInteger(seats) || seats < 2 || seats > 15) {
      return c.json({error:'Seats must be a whole number between 2 and 15'},400);
    }
    const highest = await c.env.DB.prepare(
      'SELECT MAX(seat_number) AS highest FROM game_players WHERE game_id=? AND seat_number IS NOT NULL'
    ).bind(gameId).first<{highest:number|null}>();
    if ((highest?.highest ?? 0) > seats) {
      return c.json({error:'Cannot remove an occupied seat. Move or unseat players from the highest-numbered seats first.'},409);
    }
    if(c.env.PKR_RSVP_V2==='1'){
      const booked=await c.env.DB.prepare(
        "SELECT MAX(seat_number) AS highest FROM game_rsvp_guests WHERE game_id=? AND status='yes'"
      ).bind(gameId).first<{highest:number|null}>();
      if((booked?.highest??0)>seats)
        return c.json({error:'An RSVP has reserved one of those seats. Ask the player to change their seat first.'},409);
    }
  }
  const result = await c.env.DB.prepare(`UPDATE games SET
    scheduled_at=COALESCE(?,scheduled_at), location=COALESCE(?,location),
    notes=COALESCE(?,notes),
    seats=COALESCE(?,seats), game_password=COALESCE(?,game_password)
    WHERE id=? AND status NOT IN ('settled','cancelled')`
  ).bind(scheduled_at||null,location||null,notes||null,seats||null,game_password||null,gameId).run();
  if (result.meta.changes === 0) return c.json({error:'Game state changed, reload before editing'},409);
  const updated = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if(updated && (Number(updated.scheduled_at)!==Number(game.scheduled_at)
    || String(updated.location||'')!==String(game.location||''))){
    const eventName=await c.env.DB.prepare('SELECT name FROM events WHERE id=?')
      .bind(game.event_id).first<{name:string}>();
    try{c.executionCtx.waitUntil(sendPushToEvent(c.env,game.event_id,{
      title:'Poker game updated — '+(eventName?.name||'PKR'),
      body:'The game time or location changed. Check your updated RSVP.',
      data:{type:'game_changed',gameId,eventId:game.event_id,url:'/games/'+gameId+'/rsvp',
        notificationId:gameId+':'+String(updated.scheduled_at)+':'+String(updated.location||'')}
    }));}catch{}
  }
  return c.json(updated ? clientSafeGame(updated) : null);
});

/* ── Cancel a game; settled games must first go through explicit unsettle ── */
games.post('/games/:id/cancel', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?')
    .bind(gameId).first<{event_id:string;status:string}>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  if (game.status === 'settled') {
    return c.json({error:'Cannot cancel a settled game. Unsettle it first.'},409);
  }
  if (game.status === 'cancelled') return c.json({ok:true,status:'cancelled'});
  const result = await c.env.DB.prepare(
    "UPDATE games SET status='cancelled' WHERE id=? AND status IN ('scheduled','lobby','active')"
  ).bind(gameId).run();
  if (result.meta.changes === 0) return c.json({error:'Game state changed, reload before cancelling'},409);
  const eventName=await c.env.DB.prepare('SELECT name FROM events WHERE id=?')
    .bind(game.event_id).first<{name:string}>();
  try{c.executionCtx.waitUntil(sendPushToEvent(c.env,game.event_id,{
    title:'Game cancelled — '+(eventName?.name||'PKR'),
    body:'This scheduled game has been cancelled. Open PKR for details.',
    data:{type:'game_cancelled',gameId,eventId:game.event_id,url:'/games/'+gameId,
      notificationId:gameId}
  }));}catch{}
  return c.json({ok:true,status:'cancelled'});
});

/* ── Delete an unused/cancelled game only; never erase financial history ── */
games.delete('/games/:id', authMiddleware, async(c)=>{
  const gameId=c.req.param('id');
  const game=await c.env.DB.prepare(
    'SELECT event_id,status FROM games WHERE id=?'
  ).bind(gameId).first<{event_id:string;status:string}>();
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'host'))
    return c.json({error:'Only the host can delete a game'},403);

  // One conditional DELETE prevents a racing buy-in, hand or settlement
  // from being erased after an earlier "is this game empty?" preflight.
  // Active or settled games always retain their player/accounting records.
  const result=await c.env.DB.prepare(`
    DELETE FROM games WHERE id=? AND status IN ('scheduled','lobby','cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM game_players WHERE game_id=?
      AND (buy_ins>0 OR buy_in_total>0 OR cashout IS NOT NULL
        OR net IS NOT NULL OR settled_at IS NOT NULL)
    )
    AND NOT EXISTS (SELECT 1 FROM hands WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM settlements WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM settlement_transfers WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM tournament_state WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM tournament_rebuys WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM tournament_eliminations WHERE game_id=?)
    -- Extra guards are required on existing databases where these
    -- historical tables have no declared game_id foreign key.
    AND NOT EXISTS (SELECT 1 FROM tournament_levels WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM hand_analyses WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM paid_carryover WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM hand_actions WHERE game_id=?)
    AND NOT EXISTS (SELECT 1 FROM hand_results WHERE game_id=?)
  `).bind(gameId,gameId,gameId,gameId,gameId,gameId,gameId,gameId,
    gameId,gameId,gameId,gameId,gameId).run();
  if(!result.meta.changes)return c.json({
    error:'Game has active play, money, hands or tournament history. Deletion is blocked to preserve records.',
    code:'GAME_HAS_HISTORY',
  },409);
  return c.json({ok:true});
});

/* ═══════════════════════════════════════════
   PUBLIC VIEWS (no auth)
═══════════════════════════════════════════ */

games.get('/games/:id/lobby', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare(
    'SELECT id,event_id,scheduled_at,location,notes,seats,status FROM games WHERE id=?'
  ).bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if(!await requireEventRole(c,game.event_id,'member'))return c.json({error:'Group membership required'},403);
  const event   = await c.env.DB.prepare('SELECT id,name FROM events WHERE id=?').bind(game.event_id).first();
  // RSVP invite links are shareable. Never disclose phone numbers through
  // an unauthenticated game link.
  const rsvps   = await c.env.DB.prepare(
    'SELECT id,game_id,display_name,status,created_at FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC'
  ).bind(gameId).all();
  const players = await c.env.DB.prepare('SELECT display_name,seat_number,buy_ins FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(gameId).all();
  return c.json({ game, event, rsvps:rsvps.results, players:players.results });
});

games.get('/games/live/:token', optionalAuth, async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT id,event_id,scheduled_at,location,seats,status FROM games WHERE live_token=?').bind(token).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if(c.env.PKR_PHONE_MEMBERS_V1==='1'&&!await requireEventRole(c as any,game.event_id,'member'))return c.json({error:'Group membership required'},403);
  const event    = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<{name:string, buy_in:number}>();
  const buyInAmt = event?.buy_in ?? 0;
  const players  = await c.env.DB.prepare('SELECT display_name,seat_number,buy_ins,buy_in_total,cashout,net FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(game.id).all<any>();
  const totalIn  = players.results.reduce((s:number,p:any)=>s+(p.buy_in_total>0 ? p.buy_in_total : (p.buy_ins||0)*buyInAmt),0);
  const totalOut = players.results.reduce((s:number,p:any)=>s+(p.cashout||0),0);
  return c.json({ game, event, players:players.results, totalIn, totalOut, bank:totalIn-totalOut, buyInAmt });
});

games.get('/games/results/:token', optionalAuth, async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT id,event_id,scheduled_at,location,seats,status,results_token,variance FROM games WHERE results_token=?').bind(token).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if(c.env.PKR_PHONE_MEMBERS_V1==='1'&&!await requireEventRole(c as any,game.event_id,'member'))return c.json({error:'Group membership required'},403);
  const event     = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(game.event_id).first<{name:string}>();
  const players   = await c.env.DB.prepare('SELECT user_id,display_name,seat_number,buy_ins,buy_in_total,cashout,net,settled_at FROM game_players WHERE game_id=? ORDER BY net DESC NULLS LAST').bind(game.id).all();
  const transfers = await c.env.DB.prepare('SELECT * FROM settlement_transfers WHERE game_id=?').bind(game.id).all();
  return c.json({ game, event, players:players.results, transfers:transfers.results });
});

/* ═══════════════════════════════════════════
   RSVP
═══════════════════════════════════════════ */

games.post('/games/:id/rsvp', async (c) => {
  // Once the v2 board is enabled, do not accept unauthenticated name-only edits.
  if(c.env.PKR_RSVP_V2==='1')return c.json({
    error:'Use the updated RSVP board to respond.',code:'RSVP_V2_REQUIRED'
  },409);
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Game not found'},404);
  if (game.status==='settled'||game.status==='cancelled') return c.json({error:'Game already ended'},400);
  const { display_name, whatsapp, status } = await c.req.json();
  if (!display_name?.trim()) return c.json({error:'Name required'},400);
  await c.env.DB.prepare(`
    INSERT INTO game_rsvps(id,game_id,display_name,whatsapp,status) VALUES(?,?,?,?,?)
    ON CONFLICT(game_id,display_name) DO UPDATE SET status=excluded.status,whatsapp=COALESCE(excluded.whatsapp,whatsapp)
  `).bind(generateId(),gameId,display_name.trim(),whatsapp||null,status||'yes').run();
  // Public RSVP acknowledgements must not enumerate other players' contacts.
  const rsvps = await c.env.DB.prepare(
    'SELECT id,game_id,display_name,status,created_at FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC'
  ).bind(gameId).all();
  return c.json({ok:true, rsvps:rsvps.results});
});

/* ═══════════════════════════════════════════
   GAME STATE — start, seat, buy-in, cashout
═══════════════════════════════════════════ */

games.post('/games/:id/start', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  try {
    const game=await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
    if (!game) return c.json({error:'Game not found'},404);
    if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
    if (game.status==='settled'||game.status==='cancelled')
      return c.json({error:'Cannot start a settled or cancelled game'},409);
    if (game.status==='active') return c.json({error:'Game already active'},409);
    const body=await c.req.json().catch(()=>({password:''}));
    if (game.game_password && game.game_password !== body.password)
      return c.json({error:'Wrong password'},401);

    const existing=(await c.env.DB.prepare(
      'SELECT user_id,display_name,seat_number FROM game_players WHERE game_id=? ORDER BY created_at ASC'
    ).bind(gameId).all<ExistingGameSeat>()).results;
    const rsvps=(await c.env.DB.prepare(
      "SELECT id,display_name,whatsapp FROM game_rsvps WHERE game_id=? AND status='yes' ORDER BY created_at ASC,id ASC"
    ).bind(gameId).all<ConfirmedRsvp>()).results;
    const plan=planStartSeating(game.seats,existing,rsvps);
    // Only the winning start transaction may allocate seats.
    // Activate LAST, after guarded seating operations, within the D1 batch.
    const statements: D1PreparedStatement[]=[];

    // Existing unassigned Quick Seat players have first option on vacant seats.
    for(const move of plan.existingMoves){
      statements.push(c.env.DB.prepare(
        "UPDATE game_players SET seat_number=? WHERE game_id=? AND user_id=? AND seat_number IS NULL AND NOT EXISTS (SELECT 1 FROM game_players WHERE game_id=? AND seat_number=?) AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('active','settled','cancelled'))"
      ).bind(move.seat_number,gameId,move.user_id,gameId,move.seat_number,gameId));
    }
    for(const player of plan.newPlayers){
      const known=await c.env.DB.prepare(
        'SELECT user_id FROM event_players WHERE event_id=? AND display_name=? AND user_id IS NOT NULL'
      ).bind(game.event_id,player.display_name).first<{user_id:string}>();
      const userId=known?.user_id||'rsvp_'+player.id;
      // A late seat collision retains the RSVP with NULL seat, never displacing another player.
      statements.push(c.env.DB.prepare(
        "INSERT INTO game_players(game_id,user_id,display_name,whatsapp,seat_number,buy_ins,created_at) SELECT ?,?,?,?,CASE WHEN ? IS NULL OR EXISTS (SELECT 1 FROM game_players WHERE game_id=? AND seat_number=?) THEN NULL ELSE ? END,0,unixepoch() WHERE EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('active','settled','cancelled')) AND NOT EXISTS (SELECT 1 FROM game_players WHERE game_id=? AND (user_id=? OR display_name=?)) ON CONFLICT DO NOTHING"
      ).bind(gameId,userId,player.display_name,player.whatsapp,
        player.seat_number,gameId,player.seat_number,player.seat_number,
        gameId,gameId,userId,player.display_name));
    }

    statements.push(c.env.DB.prepare(
      "UPDATE games SET status='active' WHERE id=? AND status NOT IN ('active','settled','cancelled')"
    ).bind(gameId));
    // D1 transaction is committed only after conditional activation.
    // A losing concurrent starter cannot add more RSVP players.
    const outcome=await c.env.DB.batch(statements);
    if(!outcome[outcome.length-1]?.meta?.changes) return c.json({
      error:'Game already started or closed on another device',code:'GAME_STATE_CONFLICT',
    },409);
    const players=(await c.env.DB.prepare(
      'SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC'
    ).bind(gameId).all<any>()).results;
    return c.json({
      ok:true,players,
      unseated:players.filter((p:any)=>p.seat_number==null).map((p:any)=>p.display_name),
    });
  } catch(error) {
    console.error('Safe game start failed:',error);
    return c.json({error:'Could not start the game safely. No changes were committed.'},500);
  }
});

/* ── Conditional seating: reject stale edits and duplicate seat claims ── */
games.post('/games/:id/seat', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await c.env.DB.prepare('SELECT event_id,status,seats FROM games WHERE id=?')
    .bind(gameId).first<{event_id:string;status:string;seats:number}>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  if (game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Cannot edit seats in a closed game'},409);

  const body=await c.req.json().catch(()=>null) as {
    display_name?:unknown;whatsapp?:unknown;seat_number?:unknown;expected_seat_number?:unknown;
  }|null;
  const name=typeof body?.display_name==='string'?body.display_name.trim():'';
  if (!name||name.length>160) return c.json({error:'Valid player name required'},400);
  // Quick-seat registration may leave the physical seat unassigned (NULL).
  const seat=body?.seat_number;
  const desired=seat == null ? null : Number(seat);
  if (desired!==null && (!Number.isSafeInteger(seat)||desired<1||desired>game.seats))
    return c.json({error:'Seat must be an available number in this game'},400);
  // Do not let a host accidentally take a guest's reserved seat before start.
  if(c.env.PKR_RSVP_V2==='1' && desired!==null &&
     (game.status==='scheduled'||game.status==='lobby')){
    const booked=await c.env.DB.prepare(
      "SELECT display_name FROM game_rsvp_guests WHERE game_id=? AND seat_number=? AND status='yes'"
    ).bind(gameId,desired).first<{display_name:string}>();
    if(booked && booked.display_name.toLowerCase()!==name.toLowerCase())
      return c.json({error:'This seat is reserved by '+booked.display_name+'. Ask the player to change their RSVP first.',
        code:'RSVP_SEAT_RESERVED'},409);
  }
  const phone=typeof body?.whatsapp==='string'&&body.whatsapp.trim()?body.whatsapp.trim():null;
  const hasExpected=!!body&&Object.prototype.hasOwnProperty.call(body,'expected_seat_number');
  const expected=body?.expected_seat_number;
  if (hasExpected&&expected!==null&&(!Number.isSafeInteger(expected)||Number(expected)<1))
    return c.json({error:'Invalid original seat number'},400);
  const list=()=>getPlayers(c.env.DB,gameId,revisionMode(c.env));
  const existing=await c.env.DB.prepare(
    'SELECT user_id,seat_number,display_name,buy_ins,buy_in_total,cashout FROM game_players WHERE game_id=? AND display_name=?'
  ).bind(gameId,name).first<any>();
  // A hand's live roster must not silently change between recorded actions.
  // Unassigned RSVP registrations remain possible; a physical seat cannot
  // be changed while an unfinished, non-voided hand is being recorded.
  const openHand=await c.env.DB.prepare(
    'SELECT h.id FROM hands h WHERE h.game_id=? AND h.voided=0 '+
    'AND NOT EXISTS (SELECT 1 FROM hand_results r WHERE r.hand_id=h.id) LIMIT 1'
  ).bind(gameId).first<{id:string}>();
  if(openHand && desired!==null && (!existing || existing.seat_number!==desired))
    return c.json({error:'Finish or void the current hand before changing seats.',
      code:'HAND_ACTIVE'},409);
  if (existing) {
    if (existing.seat_number===desired) {
      const players=await list();
      return c.json({ok:true,already_seated:true,players:players.results});
    }
    if (!hasExpected) return c.json({
      error:'Original seat required before moving a player.',
      code:'PRECONDITION_REQUIRED',current:{seat_number:existing.seat_number},
    },428);
    const moved=await c.env.DB.prepare(`
      UPDATE game_players SET seat_number=?,whatsapp=COALESCE(?,whatsapp)
      WHERE game_id=? AND user_id=? AND seat_number IS ?
      AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
      AND NOT EXISTS (SELECT 1 FROM game_players WHERE game_id=? AND seat_number=? AND user_id<>?)
      AND NOT EXISTS (SELECT 1 FROM hands h WHERE h.game_id=?
        AND h.voided=0 AND NOT EXISTS(
          SELECT 1 FROM hand_results r WHERE r.hand_id=h.id))
    `).bind(desired,phone,gameId,existing.user_id,expected,
      gameId,gameId,desired,existing.user_id,gameId).run();
    if (moved.meta.changes===0) {
      const current=await c.env.DB.prepare(
        'SELECT seat_number FROM game_players WHERE game_id=? AND user_id=?'
      ).bind(gameId,existing.user_id).first<{seat_number:number|null}>();
      if (!current) return c.json({error:'Player no longer seated',code:'SEAT_CONFLICT'},409);
      if (current.seat_number===desired) {
        const players=await list();
        return c.json({ok:true,already_seated:true,players:players.results});
      }
      return c.json({
        error:'Another host changed this seat, or the destination is occupied.',
        code:'SEAT_CONFLICT',current:{seat_number:current.seat_number},
      },409);
    }
    const players=await list();
    return c.json({ok:true,players:players.results});
  }

  // Single D1 statement checks that game is open and target seat vacant.
  const known=await c.env.DB.prepare(
    'SELECT user_id FROM event_players WHERE event_id=? AND display_name=? AND user_id IS NOT NULL'
  ).bind(game.event_id,name).first<{user_id:string}>();
  const userId=known?.user_id||'manual_'+generateId();
  const inserted=await c.env.DB.prepare(`
    INSERT INTO game_players(game_id,user_id,display_name,whatsapp,seat_number,buy_ins,created_at)
    SELECT ?,?,?,?,?,0,unixepoch()
    WHERE EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
    AND NOT EXISTS (SELECT 1 FROM game_players WHERE game_id=? AND seat_number=?)
    AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM hands h WHERE h.game_id=?
      AND h.voided=0 AND NOT EXISTS(
        SELECT 1 FROM hand_results r WHERE r.hand_id=h.id)))
    ON CONFLICT DO NOTHING
  `).bind(gameId,userId,name,phone,desired,gameId,gameId,desired,
    desired,gameId).run();
  if (inserted.meta.changes===0) {
    const same=await c.env.DB.prepare(
      'SELECT seat_number FROM game_players WHERE game_id=? AND display_name=?'
    ).bind(gameId,name).first<{seat_number:number|null}>();
    if (same?.seat_number===desired) {
      const players=await list();
      return c.json({ok:true,already_seated:true,players:players.results});
    }
    return c.json({
      error:'Seat occupied or player already seated elsewhere.',
      code:'SEAT_CONFLICT',current:same?{seat_number:same.seat_number}:null,
    },409);
  }
  // Register in the event only after a real new seat was inserted.
  await c.env.DB.prepare(`
    INSERT INTO event_players(id,event_id,display_name,whatsapp,games_played) VALUES(?,?,?,?,1)
    ON CONFLICT(event_id,display_name) DO UPDATE SET whatsapp=COALESCE(excluded.whatsapp,whatsapp)
  `).bind(generateId(),game.event_id,name,phone).run();
  const players=await list();
  return c.json({ok:true,players:players.results});
});

/* ── Removing a player must not erase money or hand history ── */
games.delete('/games/:id/seat/:userId', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const userId=c.req.param('userId');
  const game=await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?')
    .bind(gameId).first<{event_id:string;status:string}>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  if (game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Cannot remove a player in a closed game'},409);
  const body=await c.req.json().catch(()=>null) as {expected_seat_number?:number|null}|null;
  if (!body||!Object.prototype.hasOwnProperty.call(body,'expected_seat_number'))
    return c.json({error:'Original seat required for removal',code:'PRECONDITION_REQUIRED'},428);
  const expected=body.expected_seat_number;
  if (expected!==null&&(!Number.isSafeInteger(expected)||Number(expected)<1))
    return c.json({error:'Invalid original seat number'},400);
  const result=await c.env.DB.prepare(`
    DELETE FROM game_players WHERE game_id=? AND user_id=? AND seat_number IS ?
    AND buy_ins=0 AND buy_in_total=0 AND cashout IS NULL AND net IS NULL AND settled_at IS NULL
    AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
    AND NOT EXISTS (SELECT 1 FROM hand_actions WHERE game_id=?
      AND (user_id=? OR display_name=game_players.display_name COLLATE NOCASE))
    AND NOT EXISTS (SELECT 1 FROM hand_results WHERE game_id=?
      AND (winner_user_id=? OR winner_name=game_players.display_name COLLATE NOCASE))
    AND NOT EXISTS (SELECT 1 FROM hands h WHERE h.game_id=?
      AND h.voided=0 AND NOT EXISTS(
        SELECT 1 FROM hand_results r WHERE r.hand_id=h.id))
  `).bind(gameId,userId,expected,gameId,gameId,userId,gameId,userId,gameId).run();
  if (result.meta.changes===0) {
    const current=await c.env.DB.prepare(
      'SELECT seat_number,buy_ins,buy_in_total,cashout,net,settled_at FROM game_players WHERE game_id=? AND user_id=?'
    ).bind(gameId,userId).first<any>();
    if (current) {
      if (current.seat_number!==expected) return c.json({
        error:'Player moved on another device.',code:'SEAT_CONFLICT',
        current:{seat_number:current.seat_number},
      },409);
      return c.json({
        error:'Cannot delete a player with money, results or hand activity.',
        code:'PLAYER_HAS_HISTORY',
      },409);
    }
    const players=await c.env.DB.prepare(
      'SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC'
    ).bind(gameId).all();
    return c.json({ok:true,already_removed:true,players:players.results});
  }
  const players=await c.env.DB.prepare(
    'SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC'
  ).bind(gameId).all();
  return c.json({ok:true,players:players.results});
});

/* ── Exact buy-in update with an atomic expected-value guard ── */
games.put('/games/:id/buyin/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const body = await c.req.json().catch(() => null) as {
    count:number;total:number;expected_count:number;expected_total:number;
    expected_revision?:number;
  } | null;
  if (!body || typeof body !== 'object') return c.json({error:'Invalid buy-in request'},400);
  if (!Object.prototype.hasOwnProperty.call(body,'expected_count') ||
      !Object.prototype.hasOwnProperty.call(body,'expected_total')) {
    return c.json({error:'Original buy-in amounts required. Reload and review before editing.',code:'PRECONDITION_REQUIRED'},428);
  }
  const enabled=revisionMode(c.env),versionRequested=body.expected_revision;
  if(enabled&&(!Number.isSafeInteger(versionRequested)||(versionRequested as number)<0))
    return c.json({error:'Current player revision is required. Reload before editing.',
      code:'PRECONDITION_REQUIRED'},428);
  if(!enabled&&versionRequested!==undefined)
    return c.json({error:'Financial revision protection is not enabled in this environment.',
      code:'REVISION_UNAVAILABLE'},503);
  const {count,total,expected_count,expected_total} = body;
  if (![count,total,expected_count,expected_total].every(v => Number.isSafeInteger(v) && v >= 0) ||
      (count === 0 && total !== 0)) {
    return c.json({error:'Buy-in amounts must be non-negative integer cents'},400);
  }
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  if (game.status==='settled'||game.status==='cancelled') {
    return c.json({error:'Cannot edit a settled or cancelled game'},409);
  }
  // The write checks prior money and open-game status in ONE D1 statement.
  // A stale browser cannot overwrite another host's distinct edit.
  const result=enabled
    ? await c.env.DB.prepare(`
      UPDATE game_players SET buy_ins=?,buy_in_total=?
      WHERE game_id=? AND user_id=? AND buy_ins=? AND buy_in_total=?
      AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
      AND EXISTS (SELECT 1 FROM game_player_revisions
        WHERE game_id=? AND user_id=? AND revision=?)
    `).bind(count,total,gameId,userId,expected_count,expected_total,
      gameId,gameId,userId,versionRequested).run()
    : await c.env.DB.prepare(
      'UPDATE game_players SET buy_ins=?,buy_in_total=? ' +
      'WHERE game_id=? AND user_id=? AND buy_ins=? AND buy_in_total=? ' +
      "AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))"
    ).bind(count,total,gameId,userId,expected_count,expected_total,gameId).run();
  const current = await c.env.DB.prepare(
    'SELECT user_id,display_name,buy_ins,buy_in_total,cashout FROM game_players WHERE game_id=? AND user_id=?'
  ).bind(gameId,userId).first<any>();
  if (!current) return c.json({error:'Player no longer exists in this game'},404);
  const version=enabled?await c.env.DB.prepare(
    'SELECT revision FROM game_player_revisions WHERE game_id=? AND user_id=?'
  ).bind(gameId,userId).first<{revision:number}>():null;
  if(enabled&&!Number.isSafeInteger(version?.revision))
    return c.json({error:'Revision ledger is not initialised.',code:'REVISION_UNAVAILABLE'},503);
  if (result.meta.changes === 0) {
    const latest = await c.env.DB.prepare('SELECT status FROM games WHERE id=?').bind(gameId).first<any>();
    if (!latest||latest.status==='settled'||latest.status==='cancelled')
      return c.json({error:'Game closed before the change could be saved',code:'GAME_CLOSED'},409);
    if (!enabled&&current.buy_ins===count&&current.buy_in_total===total)
      return c.json({ok:true,already_applied:true,buy_ins:count,buy_in_total:total});
    return c.json({
      error:'Another host changed these buy-ins. Review both amounts before retrying.',
      code:'EDIT_CONFLICT',current:{buy_ins:current.buy_ins,buy_in_total:current.buy_in_total,
        ...(enabled?{revision:version?.revision}:{})},
    },409);
  }
  if (count > 0 && total > expected_total) {
    const event = await c.env.DB.prepare('SELECT name FROM events WHERE id=?')
      .bind(game.event_id).first<{name:string}>();
    const added = '$'+((total-expected_total)/100).toFixed(0);
    const message = count > 1
      ? 'Buy-in recorded — '+added+' ($'+(total/100).toFixed(0)+' total)'
      : "Buy-in recorded — you're in for "+added;
    c.executionCtx.waitUntil(sendPushToPlayer(c.env,game.event_id,current.display_name,{
      title:event?.name||'PKR',body:message,
      data:{gameId,eventId:game.event_id,type:'buyin'},
    }));
  }
  return c.json({ok:true,buy_ins:count,buy_in_total:total,
    ...(enabled?{revision:version?.revision}:{})});
});

/* ── Exact cash-out update using null-safe compare-and-swap ── */
games.put('/games/:id/cashout/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const body = await c.req.json().catch(() => null) as {
    cashout:number|null;expected_cashout:number|null;expected_revision?:number;
  } | null;
  if (!body || typeof body !== 'object' ||
      !Object.prototype.hasOwnProperty.call(body,'cashout')) {
    return c.json({error:'Invalid cash-out request'},400);
  }
  if (!Object.prototype.hasOwnProperty.call(body,'expected_cashout')) {
    return c.json({error:'Original cash-out amount required. Reload and review before editing.',code:'PRECONDITION_REQUIRED'},428);
  }
  const enabled=revisionMode(c.env),versionRequested=body.expected_revision;
  if(enabled&&(!Number.isSafeInteger(versionRequested)||(versionRequested as number)<0))
    return c.json({error:'Current player revision required. Reload before editing.',
      code:'PRECONDITION_REQUIRED'},428);
  if(!enabled&&versionRequested!==undefined)
    return c.json({error:'Financial revision protection is not enabled in this environment.',
      code:'REVISION_UNAVAILABLE'},503);
  const {cashout,expected_cashout} = body;
  if ((cashout!==null&&(!Number.isSafeInteger(cashout)||cashout<0)) ||
      (expected_cashout!==null&&(!Number.isSafeInteger(expected_cashout)||expected_cashout<0))) {
    return c.json({error:'Cash-out must be null or non-negative integer cents'},400);
  }
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?')
    .bind(gameId).first<{event_id:string;status:string}>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  if (game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Cannot edit a settled or cancelled game'},409);

  // IS ? makes both NULL -> NULL and cents -> cents comparisons atomic.
  const result=enabled
    ? await c.env.DB.prepare(`
      UPDATE game_players SET cashout=?
      WHERE game_id=? AND user_id=? AND cashout IS ?
      AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))
      AND EXISTS (SELECT 1 FROM game_player_revisions
        WHERE game_id=? AND user_id=? AND revision=?)
    `).bind(cashout,gameId,userId,expected_cashout,gameId,
      gameId,userId,versionRequested).run()
    : await c.env.DB.prepare(
      'UPDATE game_players SET cashout=? WHERE game_id=? AND user_id=? AND cashout IS ? ' +
      "AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))"
    ).bind(cashout,gameId,userId,expected_cashout,gameId).run();
  const version=enabled?await c.env.DB.prepare(
    'SELECT revision FROM game_player_revisions WHERE game_id=? AND user_id=?'
  ).bind(gameId,userId).first<{revision:number}>():null;
  if(enabled&&!Number.isSafeInteger(version?.revision))
    return c.json({error:'Revision ledger is not initialised.',code:'REVISION_UNAVAILABLE'},503);
  if (result.meta.changes === 0) {
    const current = await c.env.DB.prepare('SELECT cashout FROM game_players WHERE game_id=? AND user_id=?')
      .bind(gameId,userId).first<{cashout:number|null}>();
    if (!current) return c.json({error:'Player no longer exists in this game'},404);
    const latest = await c.env.DB.prepare('SELECT status FROM games WHERE id=?').bind(gameId).first<any>();
    if (!latest||latest.status==='settled'||latest.status==='cancelled')
      return c.json({error:'Game closed before the change could be saved',code:'GAME_CLOSED'},409);
    if(!enabled&&current.cashout===cashout) return c.json({ok:true,already_applied:true,cashout});
    return c.json({
      error:'Another host changed this cash-out. Review both amounts before retrying.',
      code:'EDIT_CONFLICT',current:{cashout:current.cashout,
        ...(enabled?{revision:version?.revision}:{})},
    },409);
  }
  return c.json({ok:true,cashout,
    ...(enabled?{revision:version?.revision}:{})});
});

// Legacy incremental buy-in is deliberately fail-closed: a duplicated request
// after an HTTP timeout must never charge or count a second buy-in.
// Use the conditional absolute PUT endpoint, with original values, instead.
games.post('/games/:id/buyin/:userId', authMiddleware, async (c) => {
  return c.json({
    error:'Unprotected incremental buy-ins are disabled. Refresh the app and use the guarded buy-in update.',
    code:'PRECONDITION_REQUIRED',
  },428);
});

games.post('/games/:id/cashout/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled' || game.status==='cancelled') {
    return c.json({error:'Cannot edit a settled or cancelled game'},409);
  }
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const { cashout } = await c.req.json<{cashout:number}>();
  if (!Number.isSafeInteger(cashout) || cashout < 0) return c.json({error:'Cashout must be integer cents'},400);
  // Legacy POST can only record the FIRST cash-out. Unlike the guarded PUT,
  // it carries no expected amount, so it must never overwrite a recorded value.
  const result = await c.env.DB.prepare(
    'UPDATE game_players SET cashout=? WHERE game_id=? AND user_id=? AND cashout IS NULL ' +
    "AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))"
  ).bind(cashout,gameId,userId,gameId).run();
  if (result.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      'SELECT cashout FROM game_players WHERE game_id=? AND user_id=?'
    ).bind(gameId,userId).first<{cashout:number|null}>();
    if (!current) return c.json({error:'Player not found'},404);
    const latest = await c.env.DB.prepare('SELECT status FROM games WHERE id=?').bind(gameId).first<any>();
    if (!latest||latest.status==='settled'||latest.status==='cancelled')
      return c.json({error:'Game has closed; review before editing',code:'GAME_CLOSED'},409);
    if (current.cashout!==cashout)
      return c.json({
        error:'Cash-out already exists. Review it and use a conditional correction instead.',
        code:'EDIT_CONFLICT',current:{cashout:current.cashout},
      },409);
  }
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  const player = players.results.find((p:any) => p.user_id===userId) as any;
  if (player && result.meta.changes > 0 && cashout != null) {
    const evData2 = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<{name:string; buy_in:number}>();
    const totalBuyIn = player.buy_in_total || ((player.buy_ins||1) * (evData2?.buy_in||0));
    const net2 = cashout - totalBuyIn;
    const netStr = net2 > 0 ? `+$${(net2/100).toFixed(0)}` : net2 < 0 ? `-$${Math.abs(net2/100).toFixed(0)}` : 'even';
    c.executionCtx.waitUntil(sendPushToPlayer(c.env, game.event_id, player.display_name, {
      title: `Cashed out $${(cashout/100).toFixed(0)} — ${evData2?.name||'PKR'}`,
      body: `Net: ${netStr} (bought in $${(totalBuyIn/100).toFixed(0)})`,
      data: { gameId, eventId: game.event_id, type: 'cashout' },
    }));
  }
  return c.json({ok:true, players:players.results});
});

/* ── Event known players (quick-select) ── */
games.get('/events/:eventId/players', authMiddleware, async (c) => {
  const eventId = c.req.param('eventId');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const players = await c.env.DB.prepare('SELECT id,event_id,display_name,user_id,games_played,created_at FROM event_players WHERE event_id=? ORDER BY games_played DESC').bind(eventId).all();
  return c.json(players.results);
});

/* ═══════════════════════════════════════════
   PLAYER LINK / UNLINK
═══════════════════════════════════════════ */

games.put('/games/:id/players/:userId/link', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const { real_user_id } = await c.req.json<{real_user_id:string}>();
  if (!real_user_id) return c.json({error:'real_user_id required'},400);
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled' || game.status==='cancelled') {
    return c.json({error:'Cannot change player identity in a closed game'},409);
  }
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  await c.env.DB.prepare('UPDATE game_players SET user_id=? WHERE game_id=? AND user_id=?').bind(real_user_id,gameId,userId).run();
  const player = await c.env.DB.prepare('SELECT display_name FROM game_players WHERE game_id=? AND user_id=?').bind(gameId,real_user_id).first<any>();
  if (player?.display_name) {
    await c.env.DB.prepare('UPDATE event_players SET user_id=? WHERE event_id=? AND display_name=?').bind(real_user_id,game.event_id,player.display_name).run();
  }
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(gameId).all();
  return c.json({ok:true, players:players.results});
});

games.put('/games/:id/players/:userId/unlink', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled' || game.status==='cancelled') {
    return c.json({error:'Cannot change player identity in a closed game'},409);
  }
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const newUserId = 'manual_' + crypto.randomUUID();
  await c.env.DB.prepare('UPDATE game_players SET user_id=? WHERE game_id=? AND user_id=?').bind(newUserId,gameId,userId).run();
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(gameId).all();
  return c.json({ok:true, players:players.results});
});

/* ═══════════════════════════════════════════
   SETTLEMENT
═══════════════════════════════════════════ */

games.post('/games/:id/settle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const body = await c.req.json().catch(() => null) as SettleRequest | null;
  if (!body || typeof body !== 'object') return c.json({error:'Invalid settlement request'},400);
  const { idempotency_key, results } = body;
  if (typeof idempotency_key !== 'string' || !idempotency_key.trim() || idempotency_key.length > 200) {
    return c.json({error:'A valid idempotency_key is required'},400);
  }
  if (!Array.isArray(results) || results.length < 2) {
    return c.json({error:'At least two player results are required'},400);
  }

  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);

  // Scope idempotency to this game, and only reveal cached results to its host/cohost.
  // A key reused for another game must never expose that game's private payload.
  const cached = await c.env.DB.prepare(
    'SELECT game_id,payload_json FROM settlements WHERE idempotency_key=?'
  ).bind(idempotency_key).first<{game_id:string;payload_json:string}>();
  if (cached && cached.game_id !== gameId) {
    return c.json({error:'Idempotency key has already been used for a different game'},409);
  }
  if (game.status === 'settled') {
    if (cached) return c.json({...JSON.parse(cached.payload_json),cached:true});
    const existing = await c.env.DB.prepare('SELECT id,created_at FROM settlements WHERE game_id=?')
      .bind(gameId).first<{id:string;created_at:number}>();
    return c.json({
      error:'Game already settled',
      already_settled: true,
      settlement_id: existing?.id,
      settled_at: existing?.created_at,
    }, 409);
  }
  if (game.status === 'cancelled') {
    return c.json({error:'Cannot settle a cancelled game'},409);
  }
  if (cached) return c.json({error:'Previous settlement state must be reviewed'},409);

  const eventData = await c.env.DB.prepare('SELECT buy_in FROM events WHERE id=?')
    .bind(game.event_id).first<{buy_in:number}>();
  let positions;
  let variance;
  try {
    ({ positions, variance } = prepareSettlementPositions(results, eventData?.buy_in ?? 0));
  } catch (error) {
    if (error instanceof SettlementValidationError) {
      return c.json({ error: error.message, ...error.detail }, error.status);
    }
    throw error;
  }
  const transfers = minimumTransfers(positions);
  const sid = generateId();
  const now = Math.floor(Date.now()/1000);
  const resultsToken = generateId();
  const carried = (await c.env.DB.prepare('SELECT from_user,to_user,amount,paid_at FROM paid_carryover WHERE game_id=?').bind(gameId).all<any>()).results;
  const paidAt = (t:any) => { const m = carried.find((x:any)=>x.from_user===t.from && x.to_user===t.to && x.amount===t.amount); return m ? (m.paid_at||now) : null; };
  const payload = { settlement_id:sid, game_id:gameId, results:positions, transfers, variance, settled_at:now, results_token:resultsToken };

  try {
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO settlements(id,game_id,idempotency_key,payload_json) VALUES(?,?,?,?)')
      .bind(sid,gameId,idempotency_key,JSON.stringify(payload)),
    c.env.DB.prepare("UPDATE games SET status='settled',results_token=?,variance=? WHERE id=?").bind(resultsToken,variance,gameId),
    ...positions.map((p:any) => c.env.DB.prepare(`
      INSERT INTO game_players(game_id,user_id,display_name,buy_ins,buy_in_total,cashout,net,settled_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,unixepoch())
      ON CONFLICT(game_id,display_name) DO UPDATE SET
        user_id=excluded.user_id, buy_ins=excluded.buy_ins, buy_in_total=excluded.buy_in_total, cashout=excluded.cashout, net=excluded.net, settled_at=excluded.settled_at
    `).bind(gameId,p.user_id,p.display_name,p.buy_ins,p.buy_in_total??0,p.cashout??0,p.net,now)),
    ...transfers.map(t => c.env.DB.prepare('INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount,from_name,to_name,status,paid_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(generateId(),gameId,t.from,t.to,t.amount,t.from_name||null,t.to_name||null,paidAt(t)?'paid':'owed',paidAt(t))),
    c.env.DB.prepare('DELETE FROM paid_carryover WHERE game_id=?').bind(gameId),
  ]);
  } catch(batchErr:any) {
    console.error('Settle batch error:', batchErr?.message, JSON.stringify(positions));
    if (/settlements\.game_id/i.test(batchErr?.message||'')) return c.json({error:'Game already settled', already_settled:true}, 409);
    return c.json({error:'Settlement failed: ' + (batchErr?.message||'unknown'), positions}, 500);
  }

  await rebuildLeaderboard(c.env.DB, game.event_id);

  await c.env.DB.batch(positions.map(p =>
    c.env.DB.prepare(`
      INSERT INTO event_players(id,event_id,display_name,games_played) VALUES(?,?,?,1)
      ON CONFLICT(event_id,display_name) DO UPDATE SET games_played=games_played+1
    `).bind(generateId(),game.event_id,p.display_name)
  ));

  const event = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(game.event_id).first<{name:string}>();
  c.executionCtx.waitUntil((async () => {
    for (const p of positions) {
      const netCents = p.net || 0;
      const netStr = netCents > 0 ? `+$${(netCents/100).toFixed(0)}` : netCents < 0 ? `-$${(Math.abs(netCents)/100).toFixed(0)}` : '$0';
      const emoji = netCents > 0 ? '🟢' : netCents < 0 ? '🔴' : '⚪';
      await sendPushToPlayer(c.env, game.event_id, p.display_name, {
        title: `${emoji} Game Settled — ${netStr}`,
        body: `${p.display_name}: cashed $${(p.cashout/100).toFixed(0)}, net ${netStr}. Check results!`,
        data: { gameId, eventId: game.event_id, type: 'game_settled', results_token: resultsToken },
      }).catch(() => {});
    }
    await sendPushToEvent(c.env, game.event_id, {
      title: `✅ ${event?.name||'PKR'} — Game Settled`,
      body: 'Results are in. Check the leaderboard!',
      data: { gameId, eventId: game.event_id, type: 'game_settled', results_token: resultsToken },
    });
  })());

  return c.json(payload,201);
});

/* ── UNSETTLE ── */
games.post('/games/:id/unsettle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (!await requireEventRole(c,game.event_id,'host')) return c.json({error:'Only host can unsettle'},403);
  if (game.status !== 'settled') return c.json({error:'Game is not settled'},400);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM settlements WHERE game_id=?').bind(gameId),
    c.env.DB.prepare('DELETE FROM paid_carryover WHERE game_id=?').bind(gameId),
    c.env.DB.prepare("INSERT INTO paid_carryover(game_id,from_user,to_user,amount,paid_at) SELECT game_id,from_user,to_user,amount,paid_at FROM settlement_transfers WHERE game_id=? AND status='paid'").bind(gameId),
    c.env.DB.prepare('DELETE FROM settlement_transfers WHERE game_id=?').bind(gameId),
    c.env.DB.prepare('UPDATE game_players SET cashout=NULL,net=NULL,settled_at=NULL WHERE game_id=?').bind(gameId),
    c.env.DB.prepare("UPDATE games SET status='active',results_token=NULL WHERE id=?").bind(gameId),
  ]);

  await rebuildLeaderboard(c.env.DB, game.event_id);

  return c.json({ok:true, message:'Game unsettled. You can now modify players and re-settle.'});
});

/* ═══════════════════════════════════════════
   LEADERBOARD — always rebuilt from source data
═══════════════════════════════════════════ */

async function rebuildLeaderboard(db: D1Database, eventId: string) {
  const settled = await db.prepare(`
    SELECT gp.user_id, gp.display_name, gp.buy_ins, gp.cashout, gp.net, gp.settled_at
    FROM game_players gp
    JOIN games g ON g.id=gp.game_id
    WHERE g.event_id=? AND g.status='settled' AND gp.net IS NOT NULL
    ORDER BY gp.user_id
  `).bind(eventId).all<any>();

  if (!settled.results.length) {
    await db.prepare('DELETE FROM leaderboard WHERE event_id=?').bind(eventId).run();
    return;
  }

  const players: Record<string, {
    user_id:string; display_name:string; games_played:number; games_won:number;
    total_net:number; biggest_win:number; biggest_loss:number; last_played:number;
  }> = {};

  for (const row of settled.results) {
    const key = row.display_name.trim().toLowerCase();
    if (!players[key]) {
      players[key] = {
        user_id:row.user_id, display_name:row.display_name,
        games_played:0, games_won:0, total_net:0,
        biggest_win:0, biggest_loss:0, last_played:0,
      };
    }
    const p = players[key];
    p.games_played++;
    p.total_net += row.net;
    if (row.net > 0) { p.games_won++; p.biggest_win = Math.max(p.biggest_win, row.net); }
    if (row.net < 0) { p.biggest_loss = Math.max(p.biggest_loss, -row.net); }
    p.last_played = Math.max(p.last_played, row.settled_at||0);
  }

  await db.batch([
    db.prepare('DELETE FROM leaderboard WHERE event_id=?').bind(eventId),
    ...Object.values(players).map(p =>
      db.prepare(`INSERT INTO leaderboard(event_id,user_id,display_name,games_played,games_won,total_net,biggest_win,biggest_loss,last_played)
        VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(eventId,p.user_id,p.display_name,p.games_played,p.games_won,p.total_net,p.biggest_win,p.biggest_loss,p.last_played)
    ),
  ]);
}

/* ═══════════════════════════════════════════
   MINIMUM TRANSFERS ALGORITHM
═══════════════════════════════════════════ */

export default games;