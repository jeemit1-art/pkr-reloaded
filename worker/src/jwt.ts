import { JWTPayload } from './types';

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

export async function signJWT(payload: Omit<JWTPayload,'iat'|'exp'>, secret: string): Promise<string> {
  const now = Math.floor(Date.now()/1000);
  const full: JWTPayload = { ...payload, iat: now, exp: now + 60*60*24*7 };
  const header = b64url({ alg:'HS256', typ:'JWT' });
  const body   = b64url(full);
  const sig    = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload|null> {
  try {
    const [header, body, sig] = token.split('.');
    const expected = await hmacSign(`${header}.${body}`, secret);
    if (sig !== expected) return null;
    const payload: JWTPayload = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

export function getTokenFromRequest(req: Request): string|null {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.get('Cookie') || '';
  const match  = cookie.match(/pkr_token=([^;]+)/);
  return match ? match[1] : null;
}
