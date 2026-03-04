import { Env } from './types';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ── VAPID JWT for authentication ─────────────────────────────────────────────
async function vapidJWT(audience: string, email: string, privateKeyB64: string): Promise<string> {
  const now = Math.floor(Date.now()/1000);
  const hdr = btoa(JSON.stringify({typ:'JWT',alg:'ES256'})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const pld = btoa(JSON.stringify({aud:audience, exp:now+3600, sub:`mailto:${email}`})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const input = `${hdr}.${pld}`;
  const rawKey = Uint8Array.from(atob(privateKeyB64.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', rawKey, {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, new TextEncoder().encode(input));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${input}.${sigB64}`;
}

// ── Web Push encryption (RFC 8291 / RFC 8188) ────────────────────────────────
// Encrypts plaintext payload using subscriber's p256dh public key + auth secret
async function encryptPayload(
  plaintext: string,
  p256dhB64: string,
  authB64: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const enc = new TextEncoder();

  // Decode subscriber keys
  const subscriberPublicKey = Uint8Array.from(
    atob(p256dhB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)
  );
  const authSecret = Uint8Array.from(
    atob(authB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)
  );

  // Generate ephemeral ECDH key pair (server side)
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );

  // Export server public key (uncompressed, 65 bytes)
  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  );

  // Import subscriber's public key
  const subscriberKey = await crypto.subtle.importKey(
    'raw', subscriberPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name:'ECDH', public: subscriberKey }, serverKeyPair.privateKey, 256)
  );

  // Random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF PRK using auth secret
  const prk = await crypto.subtle.importKey('raw', sharedSecret, { name:'HKDF' }, false, ['deriveBits']);

  // info for PRK extraction
  const prkInfo = concat(enc.encode('WebPush: info\x00'), subscriberPublicKey, serverPublicKeyRaw);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt: authSecret, info: prkInfo }, prk, 256
  ));

  // HKDF expand — derive CEK (16 bytes) and nonce (12 bytes)
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name:'HKDF' }, false, ['deriveBits']);

  const cekInfo = concat(enc.encode('Content-Encoding: aes128gcm\x00'));
  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt, info: cekInfo }, ikmKey, 128
  ));

  const nonceInfo = concat(enc.encode('Content-Encoding: nonce\x00'));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt, info: nonceInfo }, ikmKey, 96
  ));

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey('raw', cek, { name:'AES-GCM' }, false, ['encrypt']);
  // Add 2-byte padding delimiter (0x02 = final record)
  const plaintextBytes = enc.encode(plaintext);
  const padded = concat(plaintextBytes, new Uint8Array([2])); // delimiter byte

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name:'AES-GCM', iv: nonce }, aesKey, padded)
  );

  return { ciphertext, salt, serverPublicKey: serverPublicKeyRaw };
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// Build the aes128gcm content-encoding body:
// salt (16) + rs (4, big-endian uint32) + keyid_len (1) + keyid (65) + ciphertext
function buildBody(salt: Uint8Array, serverPublicKey: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const rs = 4096; // record size
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs, false);
  return concat(salt, rsBytes, new Uint8Array([serverPublicKey.length]), serverPublicKey, ciphertext);
}

// ── Send one push notification ───────────────────────────────────────────────
async function sendToSub(
  env: Env,
  sub: { endpoint: string; p256dh: string; auth_key: string },
  plaintext: string
): Promise<void> {
  try {
    const { ciphertext, salt, serverPublicKey } = await encryptPayload(plaintext, sub.p256dh, sub.auth_key);
    const body = buildBody(salt, serverPublicKey, ciphertext);

    const url = new URL(sub.endpoint);
    const jwt = await vapidJWT(`${url.protocol}//${url.host}`, env.VAPID_EMAIL, env.VAPID_PRIVATE_KEY);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/octet-stream',
        'Content-Encoding':'aes128gcm',
        'Authorization':   `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
        'TTL':             '86400',
      },
      body,
    });

    if (res.status === 410 || res.status === 404) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
    } else if (!res.ok) {
      console.error('Push failed', res.status, await res.text().catch(()=>''));
    }
  } catch(e) {
    console.error('Push send error', e);
  }
}

/** Broadcast to ALL subscribers of an event */
export async function sendPushToEvent(env: Env, eventId: string, payload: PushPayload): Promise<void> {
  const subs = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE event_id=?'
  ).bind(eventId).all<{endpoint:string; p256dh:string; auth_key:string}>();
  if (!subs.results.length) return;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  await Promise.allSettled(subs.results.map(s => sendToSub(env, s, body)));
}

/** Send push to a specific player by display_name within an event */
export async function sendPushToPlayer(env: Env, eventId: string, displayName: string, payload: PushPayload): Promise<void> {
  const name = displayName.toLowerCase().trim();
  const firstName = name.split(/\s+/)[0];

  // Match on: exact, prefix (Jim->Jimmy), contains (Jimmy->Jim), first name, or Google account name
  const subs = await env.DB.prepare(`
    SELECT endpoint, p256dh, auth_key FROM push_subscriptions
    WHERE event_id=? AND (
      LOWER(display_name) = ?
      OR LOWER(display_name) LIKE ? || '%'
      OR ? LIKE LOWER(display_name) || '%'
      OR LOWER(display_name) = ?
      OR LOWER(display_name) LIKE ? || '%'
      OR user_id IN (
        SELECT id FROM users WHERE
          LOWER(name) = ?
          OR LOWER(name) LIKE ? || '%'
          OR ? LIKE LOWER(name) || '%'
      )
    )
  `).bind(
    eventId,
    name,
    name,
    name,
    firstName,
    firstName,
    name,
    name,
    name,
  ).all<{endpoint:string; p256dh:string; auth_key:string}>();

  if (!subs.results.length) return;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  await Promise.allSettled(subs.results.map(s => sendToSub(env, s, body)));
}