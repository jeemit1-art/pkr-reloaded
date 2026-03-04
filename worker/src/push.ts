import { Env } from './types';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function vapidJWT(audience: string, email: string, privateKeyB64: string): Promise<string> {
  const now = Math.floor(Date.now()/1000);
  const hdr = btoa(JSON.stringify({typ:'JWT',alg:'ES256'})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const pld = btoa(JSON.stringify({aud:audience, exp:now+3600, sub:`mailto:${email}`})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const input = `${hdr}.${pld}`;

  const rawKey = Uint8Array.from(atob(privateKeyB64.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', rawKey, {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']
  );

  const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, new TextEncoder().encode(input));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${input}.${sigB64}`;
}

async function sendToSub(env: Env, sub: {endpoint:string; p256dh:string; auth_key:string}, body: string): Promise<void> {
  try {
    const url = new URL(sub.endpoint);
    const jwt = await vapidJWT(`${url.protocol}//${url.host}`, env.VAPID_EMAIL, env.VAPID_PRIVATE_KEY);
    const res = await fetch(sub.endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/octet-stream',
        'Authorization':`vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
        'TTL':'86400',
      },
      body,
    });
    if (res.status===410||res.status===404) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
    }
  } catch(e) { console.error('Push send failed', e); }
}

/** Broadcast to ALL subscribers of an event (game scheduled, game settled) */
export async function sendPushToEvent(env: Env, eventId: string, payload: PushPayload): Promise<void> {
  const subs = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE event_id=?'
  ).bind(eventId).all<{endpoint:string; p256dh:string; auth_key:string}>();
  if (!subs.results.length) return;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  await Promise.allSettled(subs.results.map(s => sendToSub(env, s, body)));
}

/**
 * Send push to a specific player by display_name within an event.
 * Matches anonymous lobby subscribers (stored by display_name)
 * AND Google-signed-in users whose Google name matches.
 */
export async function sendPushToPlayer(env: Env, eventId: string, displayName: string, payload: PushPayload): Promise<void> {
  const subs = await env.DB.prepare(`
    SELECT endpoint, p256dh, auth_key FROM push_subscriptions
    WHERE event_id=? AND (
      LOWER(display_name)=LOWER(?)
      OR user_id IN (SELECT id FROM users WHERE LOWER(name)=LOWER(?))
    )
  `).bind(eventId, displayName, displayName).all<{endpoint:string; p256dh:string; auth_key:string}>();
  if (!subs.results.length) return;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  await Promise.allSettled(subs.results.map(s => sendToSub(env, s, body)));
}
