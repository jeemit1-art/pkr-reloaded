import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';

const hands = new Hono<{ Bindings: Env }>();

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

// ── Toggle hand tracking on/off ─────────────────────────────────────────────
hands.post('/games/:id/tracking/toggle', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);
  const newVal = game.hand_tracking ? 0 : 1;
  await c.env.DB.prepare('UPDATE games SET hand_tracking=? WHERE id=?').bind(newVal, gameId).run();
  return c.json({ ok: true, hand_tracking: newVal });
});

// ── Start a new hand ────────────────────────────────────────────────────────
hands.post('/games/:id/hands', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  const { dealer_seat, sb_seat, bb_seat, straddle, mode } = await c.req.json();
  const handNo = (game.current_hand_no || 0) + 1;
  const id = generateId();

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO hands(id,game_id,hand_no,dealer_seat,sb_seat,bb_seat,straddle,board,pot_chips,mode) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, gameId, handNo, dealer_seat||1, sb_seat||null, bb_seat||null, straddle?1:0, '[]', 0, mode||'full'),
    c.env.DB.prepare('UPDATE games SET current_hand_no=?, current_dealer_seat=? WHERE id=?')
      .bind(handNo, dealer_seat||1, gameId),
  ]);

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=?').bind(id).first();
  return c.json(hand, 201);
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
    const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at').bind(h.id).all<any>();
    const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(h.id).first() as any;
    results.push({ ...h, board: JSON.parse(h.board || '[]'), actions: actions.results, result });
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
  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at').bind(handId).all<any>();
  const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(handId).first() as any;
  return c.json({ ...hand, board: JSON.parse(hand.board || '[]'), actions: actions.results, result });
});

// ── Update board cards ───────────────────────────────────────────────────────
hands.put('/games/:id/hands/:handId/board', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  const { board } = await c.req.json<{ board: string[] }>();
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

  const { user_id, display_name, street, action: actionType, chips } = await c.req.json();
  const action = actionType;
  if (!display_name || !street || !action) return c.json({ error: 'display_name, street, action required' }, 400);

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO hand_actions(id,hand_id,user_id,display_name,street,action,chips) VALUES(?,?,?,?,?,?,?)'
  ).bind(id, handId, user_id||null, display_name, street, action, chips||0).run();

  // Update pot_chips if chips > 0 and action is not fold
  if (chips > 0 && action !== 'fold') {
    await c.env.DB.prepare('UPDATE hands SET pot_chips=pot_chips+? WHERE id=?').bind(chips, handId).run();
  }

  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at').bind(handId).all();
  const hand = await c.env.DB.prepare('SELECT pot_chips FROM hands WHERE id=?').bind(handId).first() as any;
  return c.json({ ok: true, actions: actions.results, pot_chips: hand?.pot_chips || 0 });
});

// ── Delete last action (undo) ────────────────────────────────────────────────
hands.delete('/games/:id/hands/:handId/actions/last', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  const last = await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at DESC LIMIT 1'
  ).bind(handId).first() as any;

  if (!last) return c.json({ error: 'No actions to undo' }, 400);

  await c.env.DB.prepare('DELETE FROM hand_actions WHERE id=?').bind(last.id).run();
  // Reverse pot chips
  if (last.chips > 0 && last.action !== 'fold') {
    await c.env.DB.prepare('UPDATE hands SET pot_chips=MAX(0,pot_chips-?) WHERE id=?').bind(last.chips, handId).run();
  }

  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at').bind(handId).all();
  const hand = await c.env.DB.prepare('SELECT pot_chips FROM hands WHERE id=?').bind(handId).first() as any;
  return c.json({ ok: true, actions: actions.results, pot_chips: hand?.pot_chips || 0 });
});

// ── Declare winner ───────────────────────────────────────────────────────────
hands.post('/games/:id/hands/:handId/result', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  const { winner_user_id, winner_name, hole_cards, split_pot } = await c.req.json();
  if (!winner_name) return c.json({ error: 'winner_name required' }, 400);

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=? AND game_id=?').bind(handId, gameId).first() as any;
  if (!hand) return c.json({ error: 'Hand not found' }, 404);

  // Upsert result
  const existing = await c.env.DB.prepare('SELECT id FROM hand_results WHERE hand_id=?').bind(handId).first() as any;
  if (existing) {
    await c.env.DB.prepare(
      'UPDATE hand_results SET winner_user_id=?,winner_name=?,pot_chips=?,hole_cards=?,split_pot=? WHERE hand_id=?'
    ).bind(winner_user_id||null, winner_name, hand.pot_chips, JSON.stringify(hole_cards||{}), split_pot?1:0, handId).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO hand_results(id,hand_id,game_id,winner_user_id,winner_name,pot_chips,hole_cards,split_pot) VALUES(?,?,?,?,?,?,?,?)'
    ).bind(generateId(), handId, gameId, winner_user_id||null, winner_name, hand.pot_chips, JSON.stringify(hole_cards||{}), split_pot?1:0).run();
  }

  const result = await c.env.DB.prepare('SELECT * FROM hand_results WHERE hand_id=?').bind(handId).first();
  return c.json({ ok: true, result });
});

// ── Update D/SB/BB assignments ──────────────────────────────────────────────────
hands.put('/games/:id/hands/:handId/assign', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  const { dealer_seat, sb_seat, bb_seat } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE hands SET dealer_seat=COALESCE(?,dealer_seat), sb_seat=COALESCE(?,sb_seat), bb_seat=COALESCE(?,bb_seat) WHERE id=? AND game_id=?'
  ).bind(dealer_seat||null, sb_seat||null, bb_seat||null, handId, gameId).run();

  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=?').bind(handId).first() as any;
  return c.json({ ...hand, board: JSON.parse(hand.board || '[]') });
});

// ── Void hand ────────────────────────────────────────────────────────────────
hands.delete('/games/:id/hands/:handId', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM hand_actions WHERE hand_id=?').bind(handId),
    c.env.DB.prepare('DELETE FROM hand_results WHERE hand_id=?').bind(handId),
    c.env.DB.prepare('DELETE FROM hands WHERE id=? AND game_id=?').bind(handId, gameId),
    c.env.DB.prepare('UPDATE games SET current_hand_no=MAX(0,current_hand_no-1) WHERE id=?').bind(gameId),
  ]);
  return c.json({ ok: true });
});

// ── Undo winner ───────────────────────────────────────────────────────────────
hands.delete('/games/:id/hands/:handId/result', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const handId = c.req.param('handId');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden or not found' }, 403);

  await c.env.DB.prepare('DELETE FROM hand_results WHERE hand_id=?').bind(handId).run();
  const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id=?').bind(handId).first() as any;
  if (!hand) return c.json({ error: 'Hand not found' }, 404);
  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at').bind(handId).all();
  return c.json({ ...hand, board: JSON.parse(hand.board || '[]'), actions: actions.results, result: null });
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
    'SELECT * FROM hands WHERE game_id=? ORDER BY hand_no DESC LIMIT 1'
  ).bind(game.id).first() as any;
  if (!hand) return c.json({ hand_tracking: true, hand: null });

  const actions = await c.env.DB.prepare(
    'SELECT * FROM hand_actions WHERE hand_id=? ORDER BY created_at'
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
      result: result || null,
    },
  });
});

export default hands;
