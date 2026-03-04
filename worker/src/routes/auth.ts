import { Hono } from 'hono';
import { Env, User } from '../types';
import { signJWT } from '../jwt';
import { authMiddleware, generateId } from '../middleware';

const auth = new Hono<{ Bindings: Env }>();

auth.get('/google', async (c) => {
  const state = generateId();
  await c.env.KV.put(`oauth_state:${state}`, '1', { expirationTtl: 300 });
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
  const valid = await c.env.KV.get(`oauth_state:${state}`);
  if (!valid) return c.redirect(`${front}/?error=invalid_state`);
  await c.env.KV.delete(`oauth_state:${state}`);

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
  const cookie = [`pkr_token=${jwt}`,'Path=/','HttpOnly','SameSite=None','Secure',`Max-Age=${60*60*24*7}`].join('; ');
  // Pass token in URL for iOS Safari which blocks cross-domain cookies
  return new Response(null, { status:302, headers:{ Location:`${front}/dashboard?token=${jwt}`, 'Set-Cookie':cookie } });
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
