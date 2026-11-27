import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, optionalAuth, requireEventRole, generateId, getPlanStatus } from '../middleware';
import { clientSafeEvent, clientSafeGame } from '../public-data';
import { computeRoomLeaderboard } from '../player-leaderboard';
import {
  listRoomPlayerMerges,saveRoomPlayerMerge,removeRoomPlayerMerge,
  combineRoomPlayerLeaders,mergePairIsSafe,type RoomPlayerMerge
} from '../room-player-merges';
import {archivedHistoricalNames,normaliseHistoricalName} from './historical-visibility';
import {sendPushTestToDevice} from '../push';
import {nativePushReady,validNativeToken,registerNativeDevice,unregisterNativeDevice,
  hasNativeDevice,sendNativeSelfTest} from '../native-push';

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
    await c.env.DB.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?) ON CONFLICT(event_id,user_id) DO NOTHING').bind(eventId,userId,role).run();
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
  const effective=await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId,userId).first<{role:string}>();
  return c.json({ok:true,event: event ? clientSafeEvent(event) : null,role:effective?.role||role});
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
// Persistent room dashboard layout. This is a presentation setting in
// Cloudflare KV, not a game/finance table migration. Authenticated membership
// is required to read; only the room host may change it (not cohosts).
const DASHBOARD_KEY_PREFIX = 'room-dashboard-layout:v1:';
type DashboardLayoutName = 'command' | 'live';
events.get('/:id/dashboard-layout', authMiddleware, async (c) => {
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'member'))return c.json({error:'Room membership required'},403);
  const raw=await c.env.KV.get(DASHBOARD_KEY_PREFIX+id);
  let value:{layout:DashboardLayoutName;updated_at:number}|null=null;
  if(raw){
    try{
      const stored=JSON.parse(raw);
      if(stored&&
        (stored.layout==='command'||stored.layout==='live')&&
        Number.isSafeInteger(stored.updated_at)){
        value={layout:stored.layout,updated_at:stored.updated_at};
      }
    }catch{/* Invalid historic setting falls back to Command Centre. */}
  }
  c.header('Cache-Control','private, no-store');
  return c.json({event_id:id,layout:value?.layout||'command',
    updated_at:value?.updated_at||null});
});
events.put('/:id/dashboard-layout', authMiddleware, async (c) => {
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Only the room host can change the dashboard'},403);
  const data=await c.req.json().catch(()=>null) as {layout?:unknown}|null;
  if(!data||(data.layout!=='command'&&data.layout!=='live')||
     Object.keys(data).some(k=>k!=='layout'))
    return c.json({error:'Choose Command Centre or Live Poker'},400);
  const updated_at=Math.floor(Date.now()/1000);
  await c.env.KV.put(DASHBOARD_KEY_PREFIX+id,
    JSON.stringify({layout:data.layout,updated_at}));
  c.header('Cache-Control','private, no-store');
  return c.json({event_id:id,layout:data.layout,updated_at});
});

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
    games:games.results.map(game=>clientSafeGame(game as Record<string,unknown>)),
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

// Separate, verified native-device transport. Never accept user IDs from
// clients, and never make this available in untrusted staging.
events.post('/:id/native-push',authMiddleware,async c=>{
  const eventId=c.req.param('id');
  if(!nativePushReady(c.env))
    return c.json({error:'Native notifications are awaiting App Store credentials'},503);
  if(!await requireEventRole(c,eventId,'member'))
    return c.json({error:'Private group membership required'},403);
  const body=await c.req.json().catch(()=>null) as {token?:unknown;platform?:unknown}|null;
  if(!validNativeToken(body?.token)||(body?.platform!=='ios'&&body?.platform!=='android'))
    return c.json({error:'Invalid device token or platform'},400);
  await registerNativeDevice(c.env,eventId,c.get('userId'),body.token,body.platform);
  c.header('Cache-Control','private, no-store');
  return c.json({ok:true,registered:true});
});
events.post('/:id/native-push-status',authMiddleware,async c=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Not a member'},403);
  const body=await c.req.json().catch(()=>null) as {token?:unknown}|null;
  if(!validNativeToken(body?.token))return c.json({error:'Invalid token'},400);
  return c.json({registered:nativePushReady(c.env)&&
    await hasNativeDevice(c.env,eventId,c.get('userId'),body.token)});
});
events.delete('/:id/native-push',authMiddleware,async c=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Not a member'},403);
  const body=await c.req.json().catch(()=>null) as {token?:unknown}|null;
  if(!validNativeToken(body?.token))return c.json({error:'Invalid token'},400);
  await unregisterNativeDevice(c.env,eventId,c.get('userId'),body.token);
  c.header('Cache-Control','private, no-store');
  return c.json({ok:true});
});
events.post('/:id/native-test-push',authMiddleware,async c=>{
  const eventId=c.req.param('id');
  if(!nativePushReady(c.env))return c.json({error:'Native push not configured'},503);
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Not a member'},403);
  const body=await c.req.json().catch(()=>null) as {token?:unknown}|null;
  if(!validNativeToken(body?.token))return c.json({error:'Invalid token'},400);
  const key='native-self-test:'+eventId+':'+c.get('userId');
  if(await c.env.KV.get(key))return c.json({error:'Wait 60 seconds before testing again'},429);
  await c.env.KV.put(key,'1',{expirationTtl:60});
  const accepted=await sendNativeSelfTest(c.env,eventId,c.get('userId'),body.token);
  c.header('Cache-Control','private, no-store');
  return c.json({accepted,meaning:'expo_queue_accepted_not_device_delivered'},accepted?200:503);
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

// A real end-to-end push test. The caller can only target their own previously
// registered endpoint, and tests are rate-limited to avoid notification spam.
events.post('/:id/test-push', authMiddleware, async(c)=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))
    return c.json({error:'Private group membership required'},403);
  if(c.env.PKR_ENV==='staging')
    return c.json({error:'Real device delivery is disabled on staging'},503);
  const body=await c.req.json().catch(()=>({})) as {endpoint?:unknown};
  const endpoint=typeof body.endpoint==='string'?body.endpoint:'';
  if(!endpoint.startsWith('https://')||endpoint.length>2048)
    return c.json({error:'A valid registered device is required'},400);
  const userId=c.get('userId');
  const rateKey='push-self-test:'+eventId+':'+userId;
  if(await c.env.KV.get(rateKey))
    return c.json({error:'Please wait at least 45 seconds before testing again.'},429);
  await c.env.KV.put(rateKey,'1',{expirationTtl:45});
  const accepted=await sendPushTestToDevice(c.env,eventId,userId,endpoint);
  c.header('Cache-Control','private, no-store');
  return c.json({accepted,meaning:'push_service_accepted_not_device_received',
    ...(accepted?{}:{error:'The push service did not accept this test. Reconnect notifications and retry.'})},
    accepted?200:503);
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

// A host may reconcile two *display identities* that are confirmed to be
// the same player. The saved game_player and settlement rows are immutable.
// A preview must match the current settled ledger before the action is saved.
events.get('/:id/players/merges',authMiddleware,async c=>{
  const roomId=c.req.param('id');
  if(!await requireEventRole(c,roomId,'host'))return c.json({error:'Only the room host may review combined player histories'},403);
  try{
    const merges=await listRoomPlayerMerges(c.env.KV,roomId);
    c.header('Cache-Control','private, no-store');
    return c.json({merges});
  }catch(error){
    return c.json({error:error instanceof Error?error.message:'Could not check player history links'},503);
  }
});

events.post('/:id/players/merge',authMiddleware,async c=>{
  const roomId=c.req.param('id');
  if(!await requireEventRole(c,roomId,'host'))
    return c.json({error:'Only the room host can combine player histories'},403);
  const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
  const keys=['from_user_id','to_user_id','from_games','to_games','from_net','to_net','confirm_same_person'];
  if(!body||Object.keys(body).some(k=>!keys.includes(k))||
     typeof body.from_user_id!=='string'||typeof body.to_user_id!=='string'||
     !body.from_user_id||!body.to_user_id||
     body.from_user_id===body.to_user_id||
     body.from_user_id.length>128||body.to_user_id.length>128||
     typeof body.from_games!=='number'||typeof body.to_games!=='number'||
     typeof body.from_net!=='number'||typeof body.to_net!=='number'||
     !Number.isSafeInteger(body.from_games)||!Number.isSafeInteger(body.to_games)||
     !Number.isSafeInteger(body.from_net)||!Number.isSafeInteger(body.to_net)||
     body.confirm_same_person!==true)
    return c.json({error:'Choose two different players and confirm their current totals and identity'},400);
  try{
    const existing=await listRoomPlayerMerges(c.env.KV,roomId);
    if(existing.length>=80)return c.json({error:'This room has reached its player history link limit'},409);
    if(existing.some(link=>link.from_user_id===body.from_user_id))
      return c.json({error:'This duplicate history has already been combined. Refresh the standings.'},409);
    const current=await computeRoomLeaderboard(c.env.DB,roomId,c.env.KV);
    if('merge_warnings' in current && current.merge_warnings?.length)
      return c.json({error:'Existing identity links need review before another merge. No records changed.'},409);
    const from=current.leaders.find(row=>row.user_id===body.from_user_id);
    const to=current.leaders.find(row=>row.user_id===body.to_user_id);
    if(!from||!to)return c.json({error:'Player histories changed. Refresh the page and try again.'},409);
    if(from.games_played!==body.from_games||to.games_played!==body.to_games||
       from.total_net!==body.from_net||to.total_net!==body.to_net)
      return c.json({error:'Player game counts or net amounts have changed. Refresh before combining.'},409);
    const reason=mergePairIsSafe(from,to);
    if(reason)return c.json({error:reason},409);
    const link:RoomPlayerMerge={
      from_user_id:from.user_id,to_user_id:to.user_id,
      from_name:from.display_name,to_name:to.display_name,
      created_at:Date.now(),created_by:c.get('userId')
    };
    // Compute and reconcile the exact response before persisting the link.
    const preview=combineRoomPlayerLeaders(current.leaders,[link]);
    if(preview.applied!==1||preview.warnings.length)
      return c.json({error:'Unable to reconcile these histories safely. No changes made.'},409);
    await saveRoomPlayerMerge(c.env.KV,roomId,link);
    c.header('Cache-Control','private, no-store');
    return c.json({ok:true,merge:link,leaders:preview.leaders,
      note:'Combined standings only. Saved game, buy-in, cash-out, payment and account records are unchanged.'});
  }catch(error){
    console.warn('Player history alias merge failed',error instanceof Error?error.message:'unknown');
    return c.json({error:'Could not safely combine these histories. No financial records were changed.'},503);
  }
});

events.delete('/:id/players/merge/:fromId',authMiddleware,async c=>{
  const roomId=c.req.param('id'),fromId=c.req.param('fromId');
  if(!await requireEventRole(c,roomId,'host'))
    return c.json({error:'Only the room host can undo a player history link'},403);
  try{
    const links=await listRoomPlayerMerges(c.env.KV,roomId);
    const link=links.find(x=>x.from_user_id===fromId);
    if(!link)return c.json({error:'This player history link was not found'},404);
    if(links.some(x=>x.from_user_id!==fromId&&x.to_user_id===fromId))
      return c.json({error:'Undo the histories linked into this player first'},409);
    // Calculate the authoritative post-undo view before writing. KV reads
    // may be eventually consistent immediately after the deletion.
    const base=await computeRoomLeaderboard(c.env.DB,roomId);
    const projected=combineRoomPlayerLeaders(base.leaders,links.filter(x=>x.from_user_id!==fromId));
    if(projected.warnings.length)return c.json({error:'Another identity link requires review before undo'},409);
    await removeRoomPlayerMerge(c.env.KV,roomId,link,c.get('userId'));
    c.header('Cache-Control','private, no-store');
    return c.json({ok:true,undo:link,leaders:projected.leaders,
      note:'Only the room standings link was removed. Saved game and financial records were unchanged.'});
  }catch(error){
    return c.json({error:'Could not undo this link. Please retry without deleting player records.'},503);
  }
});

events.get('/:id/leaderboard', authMiddleware, async (c) => {
  const eventId = c.req.param('id');
  if (!await requireEventRole(c,eventId,'member')) return c.json({error:'Forbidden'},403);
  // Calculate directly from immutable settled-game rows. The older cached
  // leaderboard grouped by name; a renamed player could appear twice while
  // their history selected overlapping rows by ID.
  const {leaders}=await computeRoomLeaderboard(c.env.DB,eventId,c.env.KV);
  return c.json(leaders);
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
  `).bind(eventId, eventId).all<{display_name:string}>();
  // Archived historical identities must not be suggested for new game seats.
  // Their saved game and settlement history remains untouched.
  try{
    const archived=new Set(await archivedHistoricalNames(c.env.KV,eventId));
    return c.json(rows.results.filter(p=>!archived.has(normaliseHistoricalName(p.display_name))));
  }catch{return c.json({error:'Historical player list unavailable'},503);}
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
  if(c.env.PKR_PHONE_MEMBERS_V1==='1'){
    // Removing access must invalidate every outstanding phone/recovery link
    // before the member can rejoin. Keep their linked identity and history.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM group_phone_invites WHERE event_id=? AND contact_id IN (SELECT id FROM group_phone_contacts WHERE event_id=? AND user_id=?)').bind(eventId,eventId,targetId),
      c.env.DB.prepare("DELETE FROM event_members WHERE event_id=? AND user_id=? AND role!='host'").bind(eventId,targetId)
    ]);
  }else{
    await c.env.DB.prepare("DELETE FROM event_members WHERE event_id=? AND user_id=? AND role!='host'")
      .bind(eventId,targetId).run();
  }
  return c.json({ok:true});
});

export default events;