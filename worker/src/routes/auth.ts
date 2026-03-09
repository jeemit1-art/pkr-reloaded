// worker/src/routes/auth.ts
// FULL REPLACEMENT — adds plan fields to /me, initialises trial on signup
import { Hono } from 'hono';
import { Env, User } from '../types';
import { authMiddleware, generateId } from '../middleware';
import { signJWT, verifyJWT } from '../jwt';

const auth = new Hono<{ Bindings: Env }>();

auth.get('/google', async (c) => {
  const state = generateId();
  const params = new URLSearchParams({
    client_id:    c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    response_type:'code',
    scope:        'openid email profile',
    state,
    access_type:  'offline',
    prompt:       'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get('/callback', async (c) => {
  const { code, state, error } = c.req.query();
  const front = c.env.FRONTEND_URL;
  if (error || !code || !state) return c.redirect(`${front}/?error=oauth_denied`);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      code,
      client_id:     c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${new URL(c.req.url).origin}/auth/callback`,
      grant_type:    'authorization_code',
    }),
  });
  if (!tokenRes.ok) return c.redirect(`${front}/?error=token_failed`);
  const tokens: { access_token:string } = await tokenRes.json();

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers:{ Authorization:`Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) return c.redirect(`${front}/?error=userinfo_failed`);
  const gu: { id:string; email:string; name:string; picture:string } = await userRes.json();

  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE google_sub=?').bind(gu.id).first<User>();
  let userId: string;
  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    userId = existing.id;
    await c.env.DB.prepare('UPDATE users SET name=?,avatar_url=? WHERE id=?').bind(gu.name,gu.picture,userId).run();
    // Backfill trial_started_at for existing users who didn't have it
    if (!existing.trial_started_at) {
      await c.env.DB.prepare('UPDATE users SET trial_started_at=? WHERE id=?').bind(now, userId).run();
    }
  } else {
    userId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO users(id,google_sub,email,name,avatar_url,plan,trial_started_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(userId, gu.id, gu.email, gu.name, gu.picture, 'trial', now).run();
  }

  const jwt = await signJWT({ sub:userId, email:gu.email, name:gu.name }, c.env.JWT_SECRET);

  // Short-lived one-time code (60s)
  const loginCode = generateId();
  await c.env.KV.put(`login_code:${loginCode}`, jwt, { expirationTtl: 60 });

  const cookie = [`pkr_token=${jwt}`,'Path=/','HttpOnly','SameSite=None','Secure',`Max-Age=${60*60*24*7}`].join('; ');
  return new Response(null, {
    status: 302,
    headers: { Location:`${front}/dashboard?code=${loginCode}`, 'Set-Cookie': cookie },
  });
});

// Exchange one-time login code for JWT
auth.get('/token', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'code required' }, 400);
  const jwt = await c.env.KV.get(`login_code:${code}`);
  if (!jwt) return c.json({ error: 'Invalid or expired code' }, 404);
  await c.env.KV.delete(`login_code:${code}`);
  return c.json({ token: jwt });
});

// Token refresh
auth.post('/refresh', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare('SELECT id,email,name FROM users WHERE id=?')
    .bind(c.get('userId')).first<{id:string; email:string; name:string}>();
  if (!user) return c.json({ error: 'User not found' }, 404);
  const jwt = await signJWT({ sub: user.id, email: user.email, name: user.name }, c.env.JWT_SECRET);
  const cookie = [`pkr_token=${jwt}`,'Path=/','HttpOnly','SameSite=None','Secure',`Max-Age=${60*60*24*7}`].join('; ');
  return new Response(JSON.stringify({ token: jwt }), {
    headers: { 'Content-Type':'application/json', 'Set-Cookie': cookie },
  });
});

// /me — returns user + plan status
auth.get('/me', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, plan, trial_started_at, plan_expires_at, stripe_customer_id FROM users WHERE id=?'
  ).bind(c.get('userId')).first<User>();
  if (!user) return c.json({ error:'Not found' }, 404);

  const now = Math.floor(Date.now() / 1000);

  // Initialise trial if missing (backfill)
  if (!user.trial_started_at) {
    await c.env.DB.prepare('UPDATE users SET trial_started_at=? WHERE id=?').bind(now, user.id).run();
    user.trial_started_at = now;
  }

  const TRIAL_DAYS = 5;
  const trialEnd = user.trial_started_at + TRIAL_DAYS * 86400;
  const trialActive = user.plan === 'trial' && now < trialEnd;
  const trialDaysLeft = user.plan === 'trial' ? Math.max(0, Math.ceil((trialEnd - now) / 86400)) : 0;

  // Check expired paid plan
  let effectivePlan = user.plan;
  if ((user.plan === 'starter' || user.plan === 'pro') && user.plan_expires_at && user.plan_expires_at < now) {
    effectivePlan = 'trial';
    await c.env.DB.prepare("UPDATE users SET plan='trial' WHERE id=?").bind(user.id).run();
  }

  const isActive =
    effectivePlan === 'lifetime' ||
    effectivePlan === 'starter' ||
    effectivePlan === 'pro' ||
    trialActive;

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    plan: effectivePlan,
    trial_active: trialActive,
    trial_days_left: trialDaysLeft,
    trial_end: trialEnd,
    plan_expires_at: user.plan_expires_at,
    is_active: isActive,
    has_payment: !!user.stripe_customer_id,
    // Computed limits
    max_groups: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? null : (isActive ? null : 1),
    max_seats: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? 15 : 9,
  });
});

auth.post('/logout', (c) => new Response(JSON.stringify({ok:true}),{
  headers:{'Content-Type':'application/json','Set-Cookie':'pkr_token=; Path=/; HttpOnly; Max-Age=0'},
}));

export default auth;
