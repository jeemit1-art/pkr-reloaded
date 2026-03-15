import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';

const tournament = new Hono<{ Bindings: Env }>();

async function getGameAndVerify(c: any, gameId: string) {
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return null;
  if (!await requireEventRole(c, game.event_id, 'cohost')) return null;
  return game;
}

tournament.get('/games/:id/tournament', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);
  const state   = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  const levels  = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? ORDER BY level_num ASC').bind(gameId).all<any>();
  const rebuys  = await c.env.DB.prepare('SELECT * FROM tournament_rebuys WHERE game_id=? ORDER BY created_at DESC').bind(gameId).all<any>();
  return c.json({ state: state || null, levels: levels.results, rebuys: rebuys.results });
});

tournament.post('/games/:id/tournament/setup', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const { starting_chips, buy_in_amount, rebuy_allowed, rebuy_levels, addon_allowed, addon_chips, payout_structure, levels } = await c.req.json() as any;
  if (!levels?.length) return c.json({ error: 'levels required' }, 400);
  await c.env.DB.prepare(`INSERT INTO tournament_state (game_id,status,current_level,starting_chips,buy_in_amount,rebuy_allowed,rebuy_levels,addon_allowed,addon_chips,payout_structure,total_chips_in_play) VALUES (?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(game_id) DO UPDATE SET status='setup',current_level=1,starting_chips=excluded.starting_chips,buy_in_amount=excluded.buy_in_amount,rebuy_allowed=excluded.rebuy_allowed,rebuy_levels=excluded.rebuy_levels,addon_allowed=excluded.addon_allowed,addon_chips=excluded.addon_chips,payout_structure=excluded.payout_structure`)
    .bind(gameId,'setup',1,starting_chips||10000,buy_in_amount||0,rebuy_allowed?1:0,rebuy_levels||4,addon_allowed?1:0,addon_chips||0,JSON.stringify(payout_structure||[{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}])).run();
  await c.env.DB.prepare('DELETE FROM tournament_levels WHERE game_id=?').bind(gameId).run();
  for (const lv of levels) {
    await c.env.DB.prepare('INSERT INTO tournament_levels(id,game_id,level_num,small_blind,big_blind,ante,duration_secs,is_break) VALUES(?,?,?,?,?,?,?,?)')
      .bind(generateId(),gameId,lv.level_num,lv.small_blind,lv.big_blind,lv.ante||0,lv.duration_secs||900,lv.is_break?1:0).run();
  }
  return c.json({ ok: true });
});

tournament.post('/games/:id/tournament/start', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  if (!state) return c.json({ error: 'Tournament not set up' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const players = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM game_players WHERE game_id=? AND buy_ins>0").bind(gameId).first<{cnt:number}>();
  const totalChips = (players?.cnt || 0) * (state.starting_chips || 10000);
  await c.env.DB.prepare("UPDATE tournament_state SET status='running',started_at=?,level_started_at=?,current_level=1,total_chips_in_play=? WHERE game_id=?").bind(now,now,totalChips,gameId).run();
  const level = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? AND level_num=1').bind(gameId).first<any>();
  return c.json({ ok: true, level, total_chips_in_play: totalChips });
});

tournament.post('/games/:id/tournament/next-level', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  if (!state || state.status !== 'running') return c.json({ error: 'Tournament not running' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const nextLevel = (state.current_level || 1) + 1;
  const level = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? AND level_num=?').bind(gameId, nextLevel).first<any>();
  if (!level) return c.json({ error: 'No more levels' }, 400);
  await c.env.DB.prepare('UPDATE tournament_state SET current_level=?,level_started_at=? WHERE game_id=?').bind(nextLevel, now, gameId).run();
  return c.json({ ok: true, level, current_level: nextLevel });
});

tournament.post('/games/:id/tournament/pause', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  if (!state) return c.json({ error: 'Not found' }, 404);
  const now = Math.floor(Date.now() / 1000);
  const { paused_elapsed } = await c.req.json() as any;
  if (state.status === 'running') {
    await c.env.DB.prepare("UPDATE tournament_state SET status='paused',paused_elapsed=? WHERE game_id=?").bind(paused_elapsed||0, gameId).run();
    return c.json({ ok: true, status: 'paused' });
  } else if (state.status === 'paused') {
    const newStart = now - (state.paused_elapsed || 0);
    await c.env.DB.prepare("UPDATE tournament_state SET status='running',level_started_at=?,paused_elapsed=0 WHERE game_id=?").bind(newStart, gameId).run();
    return c.json({ ok: true, status: 'running' });
  }
  return c.json({ error: 'Cannot toggle' }, 400);
});

tournament.post('/games/:id/tournament/rebuy', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const { player_name, type, chips, amount_paid } = await c.req.json() as any;
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  if (!state) return c.json({ error: 'Not set up' }, 400);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('INSERT INTO tournament_rebuys(id,game_id,player_name,type,chips,amount_paid,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(generateId(),gameId,player_name,type||'rebuy',chips||state.starting_chips,amount_paid||0,now).run();
  await c.env.DB.prepare('UPDATE tournament_state SET total_chips_in_play=total_chips_in_play+? WHERE game_id=?').bind(chips||state.starting_chips,gameId).run();
  return c.json({ ok: true });
});

tournament.post('/games/:id/tournament/eliminate', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const { player_name, finishing_position } = await c.req.json() as any;
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('INSERT INTO tournament_eliminations(id,game_id,player_name,finishing_position,eliminated_at) VALUES(?,?,?,?,?) ON CONFLICT(game_id,player_name) DO UPDATE SET finishing_position=excluded.finishing_position,eliminated_at=excluded.eliminated_at')
    .bind(generateId(),gameId,player_name,finishing_position,now).run();
  return c.json({ ok: true });
});

tournament.get('/games/live/:token/tournament', async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT id FROM games WHERE live_token=?').bind(token).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(game.id).first<any>();
  const levels = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? ORDER BY level_num ASC').bind(game.id).all<any>();
  const elims  = await c.env.DB.prepare('SELECT * FROM tournament_eliminations WHERE game_id=? ORDER BY finishing_position DESC').bind(game.id).all<any>();
  return c.json({ state: state||null, levels: levels.results, eliminations: elims.results, server_time: Math.floor(Date.now()/1000) });
});

export default tournament;
