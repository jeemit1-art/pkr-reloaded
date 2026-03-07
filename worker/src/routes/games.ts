import { Hono } from 'hono';
import { Env, SettleRequest, Transfer } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import { sendPushToEvent, sendPushToPlayer } from '../push';

const games = new Hono<{ Bindings: Env }>();

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
  return c.json(rows.results);
});

games.post('/events/:eventId/games', authMiddleware, async (c) => {
  const eventId = c.req.param('eventId');
  if (!await requireEventRole(c,eventId,'cohost')) return c.json({error:'Forbidden'},403);
  const { scheduled_at, location, notes, seats, game_password } = await c.req.json();
  if (!scheduled_at) return c.json({error:'scheduled_at required'},400);
  const id = generateId();
  const liveToken = generateId();
  await c.env.DB.prepare(
    'INSERT INTO games(id,event_id,scheduled_at,location,notes,seats,game_password,live_token,status) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind(id,eventId,scheduled_at,location||null,notes||null,seats||9,game_password||null,liveToken,'scheduled').run();

  const event = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(eventId).first<{name:string}>();
  c.executionCtx.waitUntil(sendPushToEvent(c.env, eventId, {
    title:`🃏 ${event?.name||'PKR'} — Game Scheduled`,
    body:`Game scheduled — tap to view details`,
    data:{ gameId:id, eventId, type:'game_scheduled', scheduled_at, location:location||null },
  }));
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(id).first();
  return c.json(game,201);
});

/* ── Get single game (with players + rsvps) ── */
games.get('/games/:id', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (!await requireEventRole(c,game.event_id,'member')) return c.json({error:'Forbidden'},403);
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  const rsvps   = await c.env.DB.prepare('SELECT * FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC').bind(gameId).all();
  const event   = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<any>();
  // If settled, attach transfers too
  const transfers = game.status==='settled'
    ? (await c.env.DB.prepare('SELECT * FROM settlement_transfers WHERE game_id=?').bind(gameId).all()).results
    : [];
  return c.json({...game, buy_in: event?.buy_in ?? 0, event_name: event?.name ?? '', players:players.results, rsvps:rsvps.results, transfers});
});

/* ── Update game ── */
games.put('/games/:id', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled') return c.json({error:'Cannot modify settled game. Unsettle first.'},400);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const { scheduled_at, location, notes, status, seats, game_password } = await c.req.json();
  await c.env.DB.prepare(`UPDATE games SET
    scheduled_at=COALESCE(?,scheduled_at), location=COALESCE(?,location),
    notes=COALESCE(?,notes), status=COALESCE(?,status),
    seats=COALESCE(?,seats), game_password=COALESCE(?,game_password)
    WHERE id=?`
  ).bind(scheduled_at||null,location||null,notes||null,status||null,seats||null,game_password||null,gameId).run();
  const updated = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first();
  return c.json(updated);
});

/* ── Delete game (host only) ── */
games.delete('/games/:id', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (!await requireEventRole(c,game.event_id,'host')) return c.json({error:'Only host can delete games'},403);
  // Clean leaderboard if settled
  if (game.status==='settled') {
    await rebuildLeaderboard(c.env.DB, game.event_id);
  }
  await c.env.DB.prepare('DELETE FROM games WHERE id=?').bind(gameId).run();
  return c.json({ok:true});
});

/* ═══════════════════════════════════════════
   PUBLIC VIEWS (no auth)
═══════════════════════════════════════════ */

games.get('/games/:id/lobby', async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare(
    'SELECT id,event_id,scheduled_at,location,notes,seats,status FROM games WHERE id=?'
  ).bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  const event   = await c.env.DB.prepare('SELECT id,name FROM events WHERE id=?').bind(game.event_id).first();
  const rsvps   = await c.env.DB.prepare('SELECT * FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC').bind(gameId).all();
  const players = await c.env.DB.prepare('SELECT display_name,seat_number,buy_ins FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(gameId).all();
  return c.json({ game, event, rsvps:rsvps.results, players:players.results });
});

games.get('/games/live/:token', async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT id,event_id,scheduled_at,location,seats,status FROM games WHERE live_token=?').bind(token).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  const event   = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(game.event_id).first<{name:string}>();
  const players = await c.env.DB.prepare('SELECT display_name,seat_number,buy_ins,cashout FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST').bind(game.id).all<any>();
  const totalIn  = players.results.reduce((s:number,p:any)=>s+(p.buy_ins||0),0);
  const totalOut = players.results.reduce((s:number,p:any)=>s+(p.cashout||0),0);
  return c.json({ game, event, players:players.results, totalIn, totalOut, bank:totalIn-totalOut });
});

games.get('/games/results/:token', async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE results_token=?').bind(token).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  const event     = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(game.event_id).first<{name:string}>();
  const players   = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY net DESC NULLS LAST').bind(game.id).all();
  const transfers = await c.env.DB.prepare('SELECT * FROM settlement_transfers WHERE game_id=?').bind(game.id).all();
  return c.json({ game, event, players:players.results, transfers:transfers.results });
});

/* ═══════════════════════════════════════════
   RSVP
═══════════════════════════════════════════ */

games.post('/games/:id/rsvp', async (c) => {
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
  const rsvps = await c.env.DB.prepare('SELECT * FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC').bind(gameId).all();
  return c.json({ok:true, rsvps:rsvps.results});
});

/* ═══════════════════════════════════════════
   GAME STATE — start, seat, buy-in, cashout
   All writes go to D1 (cloud). Auto-save handled
   by frontend polling PUT /games/:id every 60s.
═══════════════════════════════════════════ */

games.post('/games/:id/start', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  try {
    const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
    if (!game) return c.json({error:'Not found'},404);
    if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
    if (game.status==='settled') return c.json({error:'Game already settled'},400);
    if (game.status==='active')  return c.json({error:'Game already active'},400);
    const { password } = await c.req.json().catch(()=>({password:''}));
    if (game.game_password && game.game_password !== password) return c.json({error:'Wrong password'},401);

    // Seat all yes-RSVPs — skip if table missing
    let inserts: any[] = [];
    try {
      const rsvps = await c.env.DB.prepare("SELECT * FROM game_rsvps WHERE game_id=? AND status='yes'").bind(gameId).all<any>();
      let seatNum = 1;
      inserts = rsvps.results.map((r:any) =>
        c.env.DB.prepare(`INSERT INTO game_players(game_id,user_id,display_name,whatsapp,seat_number,buy_ins,created_at)
          VALUES(?,?,?,?,?,1,unixepoch()) ON CONFLICT(game_id,user_id) DO NOTHING`)
          .bind(gameId,`rsvp_${r.id}`,r.display_name,r.whatsapp||null,seatNum++)
      );
    } catch(_) { /* game_rsvps may not exist yet */ }

    await c.env.DB.batch([
      ...inserts,
      c.env.DB.prepare("UPDATE games SET status='active' WHERE id=?").bind(gameId),
    ]);
    const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
    return c.json({ok:true, players:players.results});
  } catch(e:any) {
    return c.json({error: e.message||'Internal error'}, 500);
  }
});

games.post('/games/:id/seat', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled') return c.json({error:'Game settled. Unsettle to modify.'},400);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const { display_name, whatsapp, seat_number, buy_ins } = await c.req.json();
  if (!display_name?.trim()) return c.json({error:'Name required'},400);
  const userId = `manual_${generateId()}`;

  // Save to known players for quick-select (cloud)
  await c.env.DB.prepare(`
    INSERT INTO event_players(id,event_id,display_name,whatsapp,games_played) VALUES(?,?,?,?,1)
    ON CONFLICT(event_id,display_name) DO UPDATE SET whatsapp=COALESCE(excluded.whatsapp,whatsapp),games_played=games_played+1
  `).bind(generateId(),game.event_id,display_name.trim(),whatsapp||null).run();

  await c.env.DB.prepare(`
    INSERT INTO game_players(game_id,user_id,display_name,whatsapp,seat_number,buy_ins,created_at) VALUES(?,?,?,?,?,?,unixepoch())
    ON CONFLICT(game_id,user_id) DO UPDATE SET buy_ins=excluded.buy_ins,seat_number=COALESCE(excluded.seat_number,seat_number)
  `).bind(gameId,userId,display_name.trim(),whatsapp||null,seat_number||null,buy_ins||1).run();

  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  return c.json({ok:true, players:players.results});
});

games.delete('/games/:id/seat/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled') return c.json({error:'Game settled. Unsettle to modify.'},400);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  await c.env.DB.prepare('DELETE FROM game_players WHERE game_id=? AND user_id=?').bind(gameId,userId).run();
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  return c.json({ok:true, players:players.results});
});

/* ── Set exact buy-in count and total ── */
games.put('/games/:id/buyin/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const { count, total } = await c.req.json<{count:number, total?:number}>();
  if (typeof count !== 'number' || count < 0) return c.json({error:'Invalid count'},400);
  await c.env.DB.prepare(
    'UPDATE game_players SET buy_ins=?, buy_in_total=? WHERE game_id=? AND user_id=?'
  ).bind(count, total ?? 0, gameId, userId).run();
  return c.json({ok:true, buy_ins:count, buy_in_total: total ?? 0});
});

/* ── Set exact cashout amount ── */
games.put('/games/:id/cashout/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const { cashout } = await c.req.json<{cashout:number}>();
  if (typeof cashout !== 'number' || cashout < 0) return c.json({error:'Invalid cashout'},400);
  await c.env.DB.prepare(
    'UPDATE game_players SET cashout=? WHERE game_id=? AND user_id=?'
  ).bind(cashout, gameId, userId).run();
  return c.json({ok:true, cashout});
});

games.post('/games/:id/buyin/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled') return c.json({error:'Game settled. Unsettle to modify.'},400);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  await c.env.DB.prepare('UPDATE game_players SET buy_ins=buy_ins+1 WHERE game_id=? AND user_id=?').bind(gameId,userId).run();
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  // Notify the specific player their buy-in was recorded
  const player = players.results.find((p:any) => p.user_id===userId) as any;
  if (player) {
    const evData = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<{name:string; buy_in:number}>();
    const buyInAmt = evData?.buy_in ? `$${(evData.buy_in/100).toFixed(0)}` : 'Buy-in';
    c.executionCtx.waitUntil(sendPushToPlayer(c.env, game.event_id, player.display_name, {
      title: `${buyInAmt} recorded — ${evData?.name||'PKR'}`,
      body: `Buy-in recorded — you're in for $${((evData?.buy_in||0)/100).toFixed(0)} (×${player.buy_ins} total).`,
      data: { gameId, eventId: game.event_id, type: 'buyin' },
    }));
  }
  return c.json({ok:true, players:players.results});
});

games.post('/games/:id/cashout/:userId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const userId = c.req.param('userId');
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (game.status==='settled') return c.json({error:'Game settled. Unsettle to modify.'},400);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);
  const { cashout } = await c.req.json();
  await c.env.DB.prepare('UPDATE game_players SET cashout=? WHERE game_id=? AND user_id=?').bind(cashout,gameId,userId).run();
  const players = await c.env.DB.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY seat_number ASC NULLS LAST,created_at ASC').bind(gameId).all();
  // Notify the specific player their cashout was recorded
  const player = players.results.find((p:any) => p.user_id===userId) as any;
  if (player && cashout != null) {
    const evData2 = await c.env.DB.prepare('SELECT name, buy_in FROM events WHERE id=?').bind(game.event_id).first<{name:string; buy_in:number}>();
    const buyInAmt2 = evData2?.buy_in || 0;
    const totalBuyIn = (player.buy_ins||1) * buyInAmt2;
    const net2 = cashout - totalBuyIn;
    const netStr = net2 > 0 ? `+$${(net2/100).toFixed(0)}` : net2 < 0 ? `-$${Math.abs(net2/100).toFixed(0)}` : 'even';
    c.executionCtx.waitUntil(sendPushToPlayer(c.env, game.event_id, player.display_name, {
      title: `Cashed out $${(cashout/100).toFixed(0)} — ${evData2?.name||'PKR'}`,
      body: `Net: ${netStr} (${player.buy_ins}× buy-in of $${(buyInAmt2/100).toFixed(0)})`,
      data: { gameId, eventId: game.event_id, type: 'cashout' },
    }));
  }
  return c.json({ok:true, players:players.results});
});

/* ── Event known players (quick-select) ── */
games.get('/events/:eventId/players', authMiddleware, async (c) => {
  const eventId = c.req.param('eventId');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const players = await c.env.DB.prepare('SELECT * FROM event_players WHERE event_id=? ORDER BY games_played DESC').bind(eventId).all();
  return c.json(players.results);
});

/* ═══════════════════════════════════════════
   SETTLEMENT — strict single-settle with unsettle
═══════════════════════════════════════════ */

games.post('/games/:id/settle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const body: SettleRequest = await c.req.json();
  const { idempotency_key, results } = body;
  if (!idempotency_key) return c.json({error:'idempotency_key required'},400);
  if (!results?.length)  return c.json({error:'results required'},400);

  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Game not found'},404);
  if (!await requireEventRole(c,game.event_id,'cohost')) return c.json({error:'Forbidden'},403);

  // ── STRICT: already settled = hard block ──
  if (game.status === 'settled') {
    const existing = await c.env.DB.prepare('SELECT * FROM settlements WHERE game_id=?').bind(gameId).first<any>();
    return c.json({
      error:'Game already settled',
      already_settled: true,
      settlement_id: existing?.id,
      settled_at: existing?.created_at,
    }, 409);
  }

  // ── Idempotency check on key (safe retry) ──
  const cached = await c.env.DB.prepare('SELECT payload_json FROM settlements WHERE idempotency_key=?')
    .bind(idempotency_key).first<{payload_json:string}>();
  if (cached) return c.json({...JSON.parse(cached.payload_json), cached:true});

  // ── Compute settlement ──
  // net = cashout - buy_in_total (cents). Frontend sends buy_in_total and net directly.
  // buy_ins is a COUNT not an amount — never subtract it from cashout.
  const positions = results.map(p => ({
    ...p,
    net: p.buy_in_total != null ? p.cashout - p.buy_in_total : (p.cashout - (p.buy_ins * (eventBuyIn||0))),
  }));
  const transfers  = minimumTransfers(positions);
  const sid = generateId();
  const now = Math.floor(Date.now()/1000);
  const resultsToken = generateId();
  const payload = { settlement_id:sid, game_id:gameId, results:positions, transfers, settled_at:now, results_token:resultsToken };

  // ── Write everything in one atomic batch ──
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO settlements(id,game_id,idempotency_key,payload_json) VALUES(?,?,?,?)')
      .bind(sid,gameId,idempotency_key,JSON.stringify(payload)),
    c.env.DB.prepare("UPDATE games SET status='settled',results_token=? WHERE id=?").bind(resultsToken,gameId),
    ...positions.map(p => c.env.DB.prepare(`
      INSERT INTO game_players(game_id,user_id,display_name,buy_ins,cashout,net,settled_at,created_at)
      VALUES(?,?,?,?,?,?,?,unixepoch())
      ON CONFLICT(game_id,user_id) DO UPDATE SET
        buy_ins=excluded.buy_ins, cashout=excluded.cashout, net=excluded.net, settled_at=excluded.settled_at
    `).bind(gameId,p.user_id,p.display_name,p.buy_ins,p.cashout,p.net,now)),
    ...transfers.map(t => c.env.DB.prepare('INSERT INTO settlement_transfers(id,game_id,from_user,to_user,amount) VALUES(?,?,?,?,?)')
      .bind(generateId(),gameId,t.from,t.to,t.amount)),
  ]);

  // ── Rebuild leaderboard from ALL settled games (not additive) ──
  await rebuildLeaderboard(c.env.DB, game.event_id);

  // ── Update event_players games_played ──
  await c.env.DB.batch(positions.map(p =>
    c.env.DB.prepare(`
      INSERT INTO event_players(id,event_id,display_name,games_played) VALUES(?,?,?,1)
      ON CONFLICT(event_id,display_name) DO UPDATE SET games_played=games_played+1
    `).bind(generateId(),game.event_id,p.display_name)
  ));

  const event = await c.env.DB.prepare('SELECT name FROM events WHERE id=?').bind(game.event_id).first<{name:string}>();
  // Send individual result notifications to each player
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
    // Also send event-wide notification
    await sendPushToEvent(c.env, game.event_id, {
      title: `✅ ${event?.name||'PKR'} — Game Settled`,
      body: 'Results are in. Check the leaderboard!',
      data: { gameId, eventId: game.event_id, type: 'game_settled', results_token: resultsToken },
    });
  })());

  return c.json(payload,201);
});

/* ── UNSETTLE — cleanly reverses a settlement ── */
games.post('/games/:id/unsettle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({error:'Not found'},404);
  if (!await requireEventRole(c,game.event_id,'host')) return c.json({error:'Only host can unsettle'},403);
  if (game.status !== 'settled') return c.json({error:'Game is not settled'},400);

  // ── Remove settlement records ──
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM settlements WHERE game_id=?').bind(gameId),
    c.env.DB.prepare('DELETE FROM settlement_transfers WHERE game_id=?').bind(gameId),
    // Clear settlement fields on players but keep them seated
    c.env.DB.prepare('UPDATE game_players SET cashout=NULL,net=NULL,settled_at=NULL WHERE game_id=?').bind(gameId),
    c.env.DB.prepare("UPDATE games SET status='active',results_token=NULL WHERE id=?").bind(gameId),
  ]);

  // ── Rebuild leaderboard WITHOUT this game ──
  await rebuildLeaderboard(c.env.DB, game.event_id);

  return c.json({ok:true, message:'Game unsettled. You can now modify players and re-settle.'});
});

/* ═══════════════════════════════════════════
   LEADERBOARD — always rebuilt from source data
   Never additive. No double-counting possible.
═══════════════════════════════════════════ */

async function rebuildLeaderboard(db: D1Database, eventId: string) {
  // Get all settled games for this event
  const settled = await db.prepare(`
    SELECT gp.user_id, gp.display_name, gp.buy_ins, gp.cashout, gp.net, gp.settled_at
    FROM game_players gp
    JOIN games g ON g.id=gp.game_id
    WHERE g.event_id=? AND g.status='settled' AND gp.net IS NOT NULL
    ORDER BY gp.user_id
  `).bind(eventId).all<any>();

  if (!settled.results.length) {
    // No settled games — wipe leaderboard for this event
    await db.prepare('DELETE FROM leaderboard WHERE event_id=?').bind(eventId).run();
    return;
  }

  // Aggregate per player from raw results
  const players: Record<string, {
    user_id:string; display_name:string; games_played:number; games_won:number;
    total_net:number; biggest_win:number; biggest_loss:number; last_played:number;
  }> = {};

  for (const row of settled.results) {
    if (!players[row.user_id]) {
      players[row.user_id] = {
        user_id:row.user_id, display_name:row.display_name,
        games_played:0, games_won:0, total_net:0,
        biggest_win:0, biggest_loss:0, last_played:0,
      };
    }
    const p = players[row.user_id];
    p.games_played++;
    p.total_net += row.net;
    if (row.net > 0) { p.games_won++; p.biggest_win = Math.max(p.biggest_win, row.net); }
    if (row.net < 0) { p.biggest_loss = Math.max(p.biggest_loss, -row.net); }
    p.last_played = Math.max(p.last_played, row.settled_at||0);
  }

  // Wipe and rewrite leaderboard atomically
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

function minimumTransfers(
  positions: Array<{user_id:string; display_name:string; net:number}>
): Transfer[] {
  const creds = positions.filter(p=>p.net>0).map(p=>({...p,bal:p.net}));
  const debts = positions.filter(p=>p.net<0).map(p=>({...p,bal:-p.net}));
  creds.sort((a,b)=>b.bal-a.bal);
  debts.sort((a,b)=>b.bal-a.bal);
  const out: Transfer[] = [];
  let i=0,j=0;
  while (i<debts.length && j<creds.length) {
    const amt = Math.min(debts[i].bal, creds[j].bal);
    if (amt>0) out.push({from:debts[i].user_id,from_name:debts[i].display_name,to:creds[j].user_id,to_name:creds[j].display_name,amount:amt});
    debts[i].bal-=amt; creds[j].bal-=amt;
    if (debts[i].bal===0) i++;
    if (creds[j].bal===0) j++;
  }
  return out;
}

export default games;