import { Hono } from 'hono';
import { Env, User } from '../types';
import { signJWT } from '../jwt';
import { authMiddleware, generateId } from '../middleware';

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
  if (existing) {
    userId = existing.id;
    await c.env.DB.prepare('UPDATE users SET name=?,avatar_url=? WHERE id=?').bind(gu.name,gu.picture,userId).run();
  } else {
    userId = generateId();
    await c.env.DB.prepare('INSERT INTO users(id,google_sub,email,name,avatar_url) VALUES(?,?,?,?,?)')
      .bind(userId,gu.id,gu.email,gu.name,gu.picture).run();
  }

  const jwt = await signJWT({ sub:userId, email:gu.email, name:gu.name }, c.env.JWT_SECRET);

  // ── Store JWT under a short-lived one-time code (30s) instead of passing it in URL ──
  const loginCode = generateId();
  await c.env.KV.put(`login_code:${loginCode}`, jwt, { expirationTtl: 30 });

  const cookie = [`pkr_token=${jwt}`,'Path=/','HttpOnly','SameSite=None','Secure',`Max-Age=${60*60*24*7}`].join('; ');
  // Pass a short-lived code — dashboard exchanges it for the real JWT
  return new Response(null, {
    status: 302,
    headers: { Location:`${front}/dashboard?code=${loginCode}`, 'Set-Cookie': cookie },
  });
});

// Exchange one-time login code for JWT (called by dashboard on load)
auth.get('/token', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'code required' }, 400);
  const jwt = await c.env.KV.get(`login_code:${code}`);
  if (!jwt) return c.json({ error: 'Invalid or expired code' }, 404);
  await c.env.KV.delete(`login_code:${code}`);
  return c.json({ token: jwt });
});

// Token refresh — issue new JWT if current one is valid
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

auth.get('/me', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare('SELECT id,email,name,avatar_url FROM users WHERE id=?')
    .bind(c.get('userId')).first();
  if (!user) return c.json({ error:'Not found' },404);
  return c.json(user);
});

auth.post('/logout', (c) => new Response(JSON.stringify({ok:true}),{
  headers:{'Content-Type':'application/json','Set-Cookie':'pkr_token=; Path=/; HttpOnly; Max-Age=0'},
}));

export default auth;