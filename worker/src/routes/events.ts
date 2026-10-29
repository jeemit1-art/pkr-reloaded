import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, optionalAuth, requireEventRole, generateId, getPlanStatus } from '../middleware';
import { clientSafeEvent, clientSafeGame } from '../public-data';

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
  return c.json(rows.results.map(clientSafeEvent));
});

events.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { name, description, buy_in, master_password } = await c.req.json();
  if (!name?.trim()) return c.json({error:'Name required'},400);

  // ── Plan gate: check group limit ──────────────────────────────────────────
  const planStatus = await getPlanStatus(c.env.DB, userId);

  if (!planStatus.is_active) {
    return c.json({
      error: 'A paid host subscription is required to create groups.',
      code: 'UPGRADE_REQUIRED',
      plan: planStatus.plan,
      feature: 'create_group',
    }, 402);
  }

  if (planStatus.max_groups !== null) {
    const { count } = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM events WHERE host_id=? AND (status IS NULL OR status != 'ended')"
    ).bind(userId).first<{count:number}>() ?? { count: 0 };

    if (count >= planStatus.max_groups) {
      return c.json({
        error: `Your plan allows ${planStatus.max_groups} active group${planStatus.max_groups===1?'':'s'}. Upgrade to Pro for unlimited groups.`,
        code: 'UPGRADE_REQUIRED',
        plan: planStatus.plan,
        feature: 'create_group',
        current_count: count,
        limit: planStatus.max_groups,
      }, 402);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const id = generateId();
  const hashedPw = master_password ? await hashPassword(master_password) : null;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO events(id,name,description,buy_in,host_id,master_password) VALUES(?,?,?,?,?,?)')
      .bind(id,name.trim(),description||null,buy_in||0,userId,hashedPw),
    c.env.DB.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)')
      .bind(id,userId,'host'),
  ]);
  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id=?').bind(id).first();
  return c.json(event ? clientSafeEvent(event) : null,201);
});

// IMPORTANT: /invite/:token MUST be before /:id
events.get('/invite/:token', authMiddleware, async (c) => {
  const token = c.req.param('token');
  const raw = await c.env.KV.get(`invite:${token}`);
  if (!raw) return c.json({error:'This invite link has expired or already been used. Ask the host to generate a new one.'},404);
  const { eventId, role, email } = JSON.parse(raw);
  if(!email)return c.json({error:'This unrestricted invitation is no longer valid. Ask the host for a personal invitation.'},403);
  const userId = c.get('userId');
  const claimant=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first<{email:string}>();
  if(!claimant?.email||claimant.email.trim().toLowerCase()!==email)
    return c.json({error:'This invitation is for a different email address. Sign in with the invited account.'},403);
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
  return c.json({ok:true,event: event ? clientSafeEvent(event) : null,role});
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
    SELECT u.id,u.name,u.avatar_url,em.role,em.joined_at
    FROM event_members em JOIN users u ON u.id=em.user_id WHERE em.event_id=?
    ORDER BY CASE em.role WHEN 'host' THEN 0 WHEN 'cohost' THEN 1 ELSE 2 END,em.joined_at
  `).bind(eventId).all();
  // Membership projection never contains email or mobile contact information.
  return c.json({...clientSafeEvent(event),members:members.results});
});

// Member-only, read-only room settlement ledger. Historical games may not
// have a results link, and GET /games/:id also loads RSVP/player tables which
// are unrelated to payment accuracy. Read the canonical transfer rows directly
// without changing paid statuses or inferring debts from player winnings.
events.get('/:id/settlement-ledger', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  // D1 batch executes these reads in a consistent transaction. Use the
  // existing settled-game records, including games with no recorded transfers.
  const [games,transfers] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT id,event_id,scheduled_at,location,notes,seats,status,
             live_token,results_token,created_at
      FROM games WHERE event_id=? AND status='settled'
      ORDER BY scheduled_at DESC,id
    `).bind(eventId),
    c.env.DB.prepare(`
      SELECT t.id,t.game_id,t.from_user AS "from",t.to_user AS "to",
             t.from_name,t.to_name,t.amount,t.status,t.paid_at
      FROM settlement_transfers t
      JOIN games g ON g.id=t.game_id
      WHERE g.event_id=? AND g.status='settled'
      ORDER BY g.scheduled_at DESC,t.id
    `).bind(eventId),
  ]);
  return c.json({
    games:games.results.map(clientSafeGame),
    transfers:transfers.results,
  });
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
  const body = await c.req.json().catch(()=>({})) as {role?:string;email?:string};
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))return c.json({error:'Enter the intended member’s email address before generating an invite'},400);
  const role = body.role === 'member' ? 'member' : 'cohost';
  const token = generateId();
  const expiresAt = Date.now() + 48*60*60*1000;
  await c.env.KV.put(`invite:${token}`, JSON.stringify({eventId,role,email,expiresAt}), {expirationTtl:60*60*48});
  return c.json({ token, url:`${c.env.FRONTEND_URL}/invite/${token}`, expires_in:'48h', expires_at:expiresAt, role, recipient_email:email });
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

events.post('/:id/subscribe', optionalAuth, async (c) => {
  const eventId = c.req.param('id');
  const { endpoint, keys, userId, display_name } = await c.req.json();
  if(c.env.PKR_PUSH_ROOMS_V2==='1'&&c.env.PKR_PHONE_MEMBERS_V1!=='1')
    return c.json({error:'Verified membership is required for multi-room push'},503);
  if(c.env.PKR_PHONE_MEMBERS_V1==='1'&&!await requireEventRole(c as any,eventId,'member'))
    return c.json({error:'Private group membership required for notifications'},403);
  if (!endpoint||!keys?.p256dh||!keys?.auth) return c.json({error:'Invalid subscription'},400);
  const event = await c.env.DB.prepare('SELECT id FROM events WHERE id=?').bind(eventId).first();
  if (!event) return c.json({error:'Event not found'},404);
  if(c.env.PKR_PUSH_ROOMS_V2==='1'){
    await c.env.DB.prepare(
      'INSERT INTO push_room_subscriptions(event_id,endpoint,user_id,p256dh,auth_key) VALUES(?,?,?,?,?) ' +
      'ON CONFLICT(event_id,endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth_key=excluded.auth_key'
    ).bind(eventId,endpoint,c.get('userId'),keys.p256dh,keys.auth).run();
    return c.json({ok:true});
  }
  await c.env.DB.prepare(`
    INSERT INTO push_subscriptions(id,event_id,user_id,display_name,endpoint,p256dh,auth_key) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET
      event_id=excluded.event_id,
      user_id=COALESCE(excluded.user_id, user_id),
      display_name=COALESCE(excluded.display_name, display_name)
  `).bind(generateId(),eventId,c.env.PKR_PHONE_MEMBERS_V1==='1'?c.get('userId'):userId||null,
    c.env.PKR_PHONE_MEMBERS_V1==='1'?null:display_name||null,endpoint,keys.p256dh,keys.auth).run();
  return c.json({ok:true});
});

// Host-only view of registered room notification devices.
// A database registration is NOT proof the device permission remains granted
// or that a push notification will be delivered. Never expose endpoints/keys.
events.get('/:id/push-registrations', authMiddleware, async(c)=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'host'))
    return c.json({error:'Only the room host can view member notification registrations'},403);
  if(c.env.PKR_PUSH_ROOMS_V2!=='1')
    return c.json({error:'Per-room notification registration status is unavailable'},503);
  const records=await c.env.DB.prepare(
    `SELECT em.user_id, COUNT(s.endpoint) AS device_count
     FROM event_members em LEFT JOIN push_room_subscriptions s
       ON s.event_id=em.event_id AND s.user_id=em.user_id
     WHERE em.event_id=? GROUP BY em.user_id`
  ).bind(eventId).all<{user_id:string;device_count:number}>();
  return c.json({
    members:records.results.map(r=>({
      user_id:r.user_id,
      device_count:Number(r.device_count)||0,
    })),
    definition:'registered_devices_not_delivery_confirmation',
  });
});

events.post('/:id/subscribe-status', authMiddleware, async(c)=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Private group membership required'},403);
  const body=await c.req.json().catch(()=>({})) as {endpoint?:unknown};
  const endpoint=typeof body.endpoint==='string'?body.endpoint:'';
  if(!endpoint)return c.json({error:'Push endpoint is required'},400);
  const query=c.env.PKR_PUSH_ROOMS_V2==='1'
    ?'SELECT 1 AS active FROM push_room_subscriptions WHERE event_id=? AND endpoint=? AND user_id=?'
    :'SELECT 1 AS active FROM push_subscriptions WHERE event_id=? AND endpoint=? AND user_id=?';
  const row=await c.env.DB.prepare(query).bind(eventId,endpoint,c.get('userId')).first();
  return c.json({subscribed:!!row});
});

events.post('/:id/unsubscribe', optionalAuth, async (c) => {
  const { endpoint } = await c.req.json();
  if (!endpoint) return c.json({error:'endpoint required'},400);
  if(c.env.PKR_PUSH_ROOMS_V2==='1'){
    if(c.env.PKR_PHONE_MEMBERS_V1!=='1'||!await requireEventRole(c as any,c.req.param('id'),'member'))
      return c.json({error:'Private group membership required'},403);
    await c.env.DB.prepare('DELETE FROM push_room_subscriptions WHERE endpoint=? AND event_id=? AND user_id=?')
      .bind(endpoint,c.req.param('id'),c.get('userId')).run();
    return c.json({ok:true});
  }
  if(c.env.PKR_PHONE_MEMBERS_V1==='1'){
    if(!await requireEventRole(c as any,c.req.param('id'),'member'))return c.json({error:'Private group membership required'},403);
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND event_id=? AND user_id=?')
      .bind(endpoint,c.req.param('id'),c.get('userId')).run();
  }else{
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint).run();
  }
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

  const result = await Promise.all(games.results.map(async (g: any) => {
    const top = await c.env.DB.prepare(`
      SELECT display_name, net FROM game_players
      WHERE game_id=? AND net IS NOT NULL
      ORDER BY net DESC
    `).bind(g.id).all<{display_name:string; net:number}>();
    return { ...clientSafeGame(g), top_players: top.results };
  }));

  return c.json(result);
});

// Known players for this event (for seat autocomplete)
events.get('/:id/players', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  const rows = await c.env.DB.prepare(`
    SELECT DISTINCT gp.display_name,
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

events.post('/:id/end', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({error:'Only host can end event'},403);
  await c.env.DB.prepare("UPDATE events SET status='ended' WHERE id=?").bind(eventId).run();
  return c.json({ok:true});
});

events.post('/:id/reopen', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({error:'Only host can reopen event'},403);
  await c.env.DB.prepare("UPDATE events SET status='active' WHERE id=?").bind(eventId).run();
  return c.json({ok:true});
});

events.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  const targetId = c.req.param('userId');
  if (!await requireEventRole(c, eventId, 'host')) return c.json({error:'Forbidden'},403);
  const me = (c as any).get('userId');
  if (targetId === me) return c.json({error:'Cannot remove yourself'},400);
  await c.env.DB.prepare('DELETE FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId, targetId).run();
  return c.json({ok:true});
});

export default events;