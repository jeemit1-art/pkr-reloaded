// worker/src/routes/auth.ts
// FULL REPLACEMENT — adds plan fields to /me, initialises trial on signup
import { Hono } from 'hono';
import { Env, User } from '../types';
import { authMiddleware, generateId } from '../middleware';
import { signJWT, verifyJWT } from '../jwt';

const auth = new Hono<{ Bindings: Env }>();

// Bind OAuth state to the initiating browser. Lax allows Google's top-level redirect.
const oauthCookieName = '__Host-pkr_oauth_state';
const clearOauthCookie = oauthCookieName + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
function rejectOauth(front: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: front + '/?error=oauth_denied', 'Set-Cookie': clearOauthCookie },
  });
}

function rejectToken(front: string, reason: string) {
  // Only a fixed, non-sensitive reason reaches the browser; never expose
  // Google token responses, authorization codes, credentials or tokens.
  const location = front + '/?error=token_failed&reason=' + encodeURIComponent(reason);
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Set-Cookie': clearOauthCookie },
  });
}

const safeGoogleTokenErrors = new Set([
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'unauthorized_client',
  'unsupported_grant_type',
]);

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
  const response = c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
  response.headers.append('Set-Cookie',
    oauthCookieName + '=' + state + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600');
  return response;
});

auth.get('/callback', async (c) => {
  const { code, state, error } = c.req.query();
  const front = c.env.FRONTEND_URL;
  const stateCookie = (c.req.header('Cookie') || '').split(';').map(x => x.trim())
    .find(x => x.startsWith(oauthCookieName + '='));
  const expectedState = stateCookie?.slice(oauthCookieName.length + 1);
  if (error || !code || !state || !expectedState || state !== expectedState) return rejectOauth(front);

  if (!c.env.GOOGLE_CLIENT_SECRET) {
    console.warn('Google OAuth token exchange: staging client secret not configured');
    return rejectToken(front, 'missing_client_secret');
  }
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
  if (!tokenRes.ok) {
    let reason = 'unknown';
    try {
      const response: unknown = await tokenRes.json();
      if (response && typeof response === 'object' && 'error' in response) {
        const errorCode = (response as { error?: unknown }).error;
        if (typeof errorCode === 'string' && safeGoogleTokenErrors.has(errorCode)) {
          reason = errorCode;
        }
      }
    } catch {
      // A non-JSON provider response is intentionally not exposed.
    }
    console.warn('Google OAuth token exchange rejected', {
      status: tokenRes.status,
      reason,
    });
    return rejectToken(front, reason);
  }
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
    headers: (() => {
      const h = new Headers({ Location: front + '/dashboard?code=' + loginCode });
      h.append('Set-Cookie', cookie);
      h.append('Set-Cookie', clearOauthCookie);
      return h;
    })(),
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

// Securely move an existing signed-in player session from a WhatsApp browser
// to an iPhone Home Screen app, which may have a separate storage context.
// Transfer codes are short-lived, high-entropy and never placed in URLs.
const transferAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newTransferCode():string{
  const random=crypto.getRandomValues(new Uint8Array(16));
  return Array.from(random,b=>transferAlphabet[b%transferAlphabet.length]).join('');
}
async function transferHash(value:string):Promise<string>{
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
}
auth.post('/transfer/start',authMiddleware,async c=>{
  const userId=c.get('userId');
  const user=await c.env.DB.prepare('SELECT id FROM users WHERE id=?')
    .bind(userId).first<{id:string}>();
  if(!user)return c.json({error:'Sign in first'},401);
  const key='pkr-app-transfer:start:'+userId;
  if(await c.env.KV.get(key))
    return c.json({error:'Please wait one minute before generating another code.'},429);
  const code=newTransferCode();
  await c.env.KV.put('pkr-app-transfer:code:'+await transferHash(code),userId,{expirationTtl:300});
  await c.env.KV.put(key,'1',{expirationTtl:60});
  c.header('Cache-Control','no-store, private');
  c.header('Referrer-Policy','no-referrer');
  return c.json({code,expires_in:300});
});
auth.post('/transfer/redeem',async c=>{
  const body=await c.req.json().catch(()=>null) as {code?:unknown}|null;
  const code=typeof body?.code==='string'
    ?body.code.replace(/[\s-]/g,'').toUpperCase():'';
  if(!/^[A-HJ-NP-Z2-9]{16}$/.test(code))
    return c.json({error:'Enter the 16-character transfer code.'},400);
  // This rate limit supplements an 80-bit random code and five-minute TTL.
  // It is not a substitute for a code with high entropy.
  const ip=c.req.header('CF-Connecting-IP')||'unknown';
  const bucket='pkr-app-transfer:rate:'+await transferHash(ip)+':'+Math.floor(Date.now()/300000);
  const count=Number(await c.env.KV.get(bucket)||'0');
  if(count>=8)return c.json({error:'Too many attempts. Try again later.'},429);
  await c.env.KV.put(bucket,String(count+1),{expirationTtl:300});
  const codeKey='pkr-app-transfer:code:'+await transferHash(code);
  const userId=await c.env.KV.get(codeKey);
  if(!userId)return c.json({error:'Code expired or invalid. Generate another code from your original browser.'},401);
  // A code is redeemed once in normal use. KV is eventually consistent,
  // so the high-entropy code must still be kept private until it expires.
  await c.env.KV.delete(codeKey);
  const user=await c.env.DB.prepare('SELECT id,email,name FROM users WHERE id=?')
    .bind(userId).first<{id:string;email:string;name:string}>();
  if(!user)return c.json({error:'Account no longer available'},404);
  const token=await signJWT({sub:user.id,email:user.email,name:user.name},c.env.JWT_SECRET);
  c.header('Cache-Control','no-store, private');
  c.header('Referrer-Policy','no-referrer');
  return c.json({token});
});

// /me — returns user + plan status
auth.get('/me', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, plan, trial_started_at, plan_expires_at, stripe_customer_id, stripe_subscription_id FROM users WHERE id=?'
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
  const trialActive = false; // Unpaid trials cannot host games.
  const trialDaysLeft = 0;

  // Check expired paid plan
  let effectivePlan = user.plan;
  if ((user.plan === 'starter' || user.plan === 'pro') && user.plan_expires_at && user.plan_expires_at < now) {
    effectivePlan = 'trial';
    await c.env.DB.prepare("UPDATE users SET plan='trial' WHERE id=?").bind(user.id).run();
  }

  const paid=(effectivePlan==='starter'||effectivePlan==='pro')&&
    !!user.stripe_subscription_id?.startsWith('sub_')&&
    Number.isSafeInteger(user.plan_expires_at)&&Number(user.plan_expires_at)>now;
  const isActive=effectivePlan==='lifetime'||paid;

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
    has_payment: !!user.stripe_customer_id&&!!user.stripe_subscription_id,
    // Computed limits
    max_groups: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? null : 1,
    max_seats: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? 15 : 9,
  });
});

auth.post('/logout', (c) => new Response(JSON.stringify({ok:true}),{
  headers:{'Content-Type':'application/json','Set-Cookie':'pkr_token=; Path=/; HttpOnly; Max-Age=0'},
}));

export default auth;
