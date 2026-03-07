import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';

const events = new Hono<{ Bindings: Env }>();

// ── Password hashing helper ──────────────────────────────────────────────────
async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

events.get('/', authMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT e.*, em.role,
      (SELECT COUNT(*) FROM event_members WHERE event_id=e.id) as member_count,
      (SELECT COUNT(*) FROM games WHERE event_id=e.id AND status NOT IN ('cancelled')) as game_count
    FROM events e JOIN event_members em ON em.event_id=e.id AND em.user_id=?
    ORDER BY e.created_at DESC
  `).bind(c.get('userId')).all();
  return c.json(rows.results);
});

events.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { name, description, buy_in, master_password } = await c.req.json();
  if (!name?.trim()) return c.json({error:'Name required'},400);
  const id = generateId();
  const hashedPw = master_password ? await hashPassword(master_password) : null;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO events(id,name,description,buy_in,host_id,master_password) VALUES(?,?,?,?,?,?)')
      .bind(id,name.trim(),description||null,buy_in||0,userId,hashedPw),
    c.env.DB.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)')
      .bind(id,userId,'host'),
  ]);
  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id=?').bind(id).first();
  return c.json(event,201);
});

// IMPORTANT: /invite/:token MUST be before /:id
events.get('/invite/:token', authMiddleware, async (c) => {
  const token = c.req.param('token');
  const raw = await c.env.KV.get(`invite:${token}`);
  if (!raw) return c.json({error:'This invite link has expired or already been used. Ask the host to generate a new one.'},404);
  const { eventId, role } = JSON.parse(raw);
  const userId = c.get('userId');
  const existing = await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId,userId).first<{role:string}>();
  if (!existing) {
    await c.env.DB.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)').bind(eventId,userId,role).run();
  } else if (existing.role==='member' && role==='cohost') {
    await c.env.DB.prepare('UPDATE event_members SET role=? WHERE event_id=? AND user_id=?').bind(role,eventId,userId).run();
  }
  await c.env.KV.delete(`invite:${token}`);
  const event = await c.env.DB.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_members WHERE event_id=e.id) as member_count,
      (SELECT COUNT(*) FROM games WHERE event_id=e.id AND status NOT IN ('cancelled')) as game_count
    FROM events e WHERE e.id=?
  `).bind(eventId).first();
  return c.json({ok:true,event,role});
});

events.get('/:id', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const event = await c.env.DB.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_members WHERE event_id=e.id) as member_count,
      (SELECT COUNT(*) FROM games WHERE event_id=e.id AND status NOT IN ('cancelled')) as game_count
    FROM events e WHERE e.id=?
  `).bind(eventId).first();
  if (!event) return c.json({error:'Not found'},404);
  const members = await c.env.DB.prepare(`
    SELECT u.id,u.name,u.avatar_url,u.email,em.role,em.joined_at
    FROM event_members em JOIN users u ON u.id=em.user_id WHERE em.event_id=?
    ORDER BY CASE em.role WHEN 'host' THEN 0 WHEN 'cohost' THEN 1 ELSE 2 END,em.joined_at
  `).bind(eventId).all();
  return c.json({...event, members:members.results});
});

// Link a member's user_id to a known player display_name
events.put('/:id/members/:userId/link', authMiddleware, async (c) => {
  const eventId  = c.req.param('id');
  const targetId = c.req.param('userId');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({ error: 'Only host can link members' }, 403);
  const { display_name } = await c.req.json();
  if (!display_name?.trim()) return c.json({ error: 'display_name required' }, 400);
  await c.env.DB.prepare('UPDATE event_players SET user_id=? WHERE event_id=? AND display_name=?')
    .bind(targetId, eventId, display_name.trim()).run();
  await c.env.DB.prepare(`UPDATE game_players SET user_id=? WHERE user_id IN (
    SELECT DISTINCT gp.user_id FROM game_players gp JOIN games g ON g.id=gp.game_id
    WHERE g.event_id=? AND gp.display_name=? AND gp.user_id != ?)`)
    .bind(targetId, eventId, display_name.trim(), targetId).run();
  return c.json({ ok: true });
});

// Remove a member from an event (host only, cannot remove self)
events.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const eventId  = c.req.param('id');
  const targetId = c.req.param('userId');
  const requesterId = c.get('userId');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({ error: 'Only host can remove members' }, 403);
  if (targetId === requesterId) return c.json({ error: 'You cannot remove yourself' }, 400);
  const target = await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId, targetId).first<{ role: string }>();
  if (!target) return c.json({ error: 'Member not found' }, 404);
  if (target.role === 'host') return c.json({ error: 'Cannot remove the host' }, 400);
  await c.env.DB.prepare('DELETE FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId, targetId).run();
  return c.json({ ok: true });
});

events.put('/:id', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'cohost')) return c.json({error:'Forbidden'},403);
  const { name, description, buy_in, master_password } = await c.req.json();
  const hashedPw = master_password ? await hashPassword(master_password) : null;
  await c.env.DB.prepare('UPDATE events SET name=?,description=?,buy_in=?,master_password=COALESCE(?,master_password) WHERE id=?')
    .bind(name,description||null,buy_in||0,hashedPw,eventId).run();
  return c.json({ok:true});
});

// Verify master password
events.post('/:id/verify-password', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const { password } = await c.req.json();
  const event = await c.env.DB.prepare('SELECT master_password FROM events WHERE id=?').bind(eventId).first<{master_password:string|null}>();
  if (!event) return c.json({error:'Not found'},404);
  if (!event.master_password) return c.json({ok:true, required:false});
  const hashed = await hashPassword(password);
  return c.json({ok: event.master_password === hashed, required:true});
});

events.post('/:id/invite', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'host')) return c.json({error:'Only host can invite'},403);
  const body = await c.req.json().catch(()=>({})) as {role?:string};
  const role = body.role === 'member' ? 'member' : 'cohost';
  const token = generateId();
  const expiresAt = Date.now() + 48*60*60*1000;
  await c.env.KV.put(`invite:${token}`, JSON.stringify({eventId,role,expiresAt}), {expirationTtl:60*60*48});
  return c.json({ token, url:`${c.env.FRONTEND_URL}/invite/${token}`, expires_in:'48h', expires_at:expiresAt, role });
});

// Member PIN join — player enters event PIN to access leaderboard/results without Google login
events.post('/:id/join', async (c) => {
  const eventId = c.req.param('id');
  const { pin } = await c.req.json();
  if (!pin) return c.json({error:'PIN required'},400);
  const event = await c.env.DB.prepare('SELECT id,name,master_password FROM events WHERE id=?').bind(eventId).first<any>();
  if (!event) return c.json({error:'Event not found'},404);
  if (!event.master_password) return c.json({error:'This event has no PIN set'},400);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  const hashed = Array.from(new Uint8Array(buf)).map((b:number)=>b.toString(16).padStart(2,'0')).join('');
  if (hashed !== event.master_password) return c.json({error:'Incorrect PIN'},403);
  return c.json({ok:true, event_id:eventId, event_name:event.name});
});

events.post('/:id/subscribe', async (c) => {
  const eventId = c.req.param('id');
  const { endpoint, keys, userId, display_name } = await c.req.json();
  if (!endpoint||!keys?.p256dh||!keys?.auth) return c.json({error:'Invalid subscription'},400);
  const event = await c.env.DB.prepare('SELECT id FROM events WHERE id=?').bind(eventId).first();
  if (!event) return c.json({error:'Event not found'},404);
  await c.env.DB.prepare(`
    INSERT INTO push_subscriptions(id,event_id,user_id,display_name,endpoint,p256dh,auth_key) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET
      event_id=excluded.event_id,
      user_id=COALESCE(excluded.user_id, user_id),
      display_name=COALESCE(excluded.display_name, display_name)
  `).bind(generateId(),eventId,userId||null,display_name||null,endpoint,keys.p256dh,keys.auth).run();
  return c.json({ok:true});
});

events.post('/:id/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json();
  if (!endpoint) return c.json({error:'endpoint required'},400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint).run();
  return c.json({ok:true});
});

events.get('/:id/leaderboard', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const rows = await c.env.DB.prepare('SELECT * FROM leaderboard WHERE event_id=? ORDER BY total_net DESC').bind(eventId).all();
  return c.json(rows.results);
});

// Game history with top 3 player results per game
events.get('/:id/history', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const games = await c.env.DB.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM game_players WHERE game_id=g.id) as player_count
    FROM games g WHERE g.event_id=? AND g.status='settled'
    ORDER BY g.scheduled_at DESC
  `).bind(eventId).all<any>();

  // Attach top 3 players (by net) to each game
  const result = await Promise.all(games.results.map(async (g: any) => {
    const top = await c.env.DB.prepare(`
      SELECT display_name, net FROM game_players
      WHERE game_id=? AND net IS NOT NULL
      ORDER BY net DESC
    `).bind(g.id).all<{display_name:string; net:number}>();
    return { ...g, top_players: top.results, all_players: top.results };
  }));

  return c.json(result);
});

// Known players for this event (for seat autocomplete)
events.get('/:id/players', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const rows = await c.env.DB.prepare(`
    SELECT DISTINCT gp.display_name, gp.whatsapp,
      COUNT(*) as games_played,
      gp.game_id as id,
      ? as event_id
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.event_id = ?
    GROUP BY gp.display_name
    ORDER BY games_played DESC
    LIMIT 50
  `).bind(eventId, eventId).all();
  return c.json(rows.results);
});

export default events;