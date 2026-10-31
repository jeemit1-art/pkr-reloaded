import { Env } from './types';
import {sendNativePushToEvent,sendNativePushToAccount,sendNativePushToManagers} from './native-push';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ── VAPID JWT for authentication ─────────────────────────────────────────────
function fromBase64Url(value: string): Uint8Array {
  const base=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),c=>c.charCodeAt(0));
}

function toBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

/** Compatible with both raw 32-byte web-push VAPID scalars and DER PKCS#8 secrets. */
export async function vapidJWT(
  audience: string,email: string,privateKeyB64: string,publicKeyB64: string,
): Promise<string> {
  const now=Math.floor(Date.now()/1000);
  const header=toBase64Url(new TextEncoder().encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const claims=toBase64Url(new TextEncoder().encode(JSON.stringify({
    aud:audience,exp:now+3600,sub:email.startsWith('mailto:')?email:'mailto:'+email,
  })));
  const input=header+'.'+claims;
  const bytes=fromBase64Url(privateKeyB64);
  let key: CryptoKey;
  if(bytes.length===32){
    // web-push generate-vapid-keys returns a raw private scalar, NOT PKCS#8.
    const publicPoint=fromBase64Url(publicKeyB64);
    if(publicPoint.length!==65||publicPoint[0]!==4)throw new Error('Invalid VAPID public key');
    key=await crypto.subtle.importKey('jwk',{
      kty:'EC',crv:'P-256',
      x:toBase64Url(publicPoint.slice(1,33)),
      y:toBase64Url(publicPoint.slice(33,65)),
      d:toBase64Url(bytes),
    },{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  }else{
    key=await crypto.subtle.importKey('pkcs8',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  }
  const signed=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input));
  return input+'.'+toBase64Url(new Uint8Array(signed));
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
  ) as CryptoKeyPair;

  // Export server public key (uncompressed, 65 bytes)
  // Web Crypto returns an ArrayBuffer for the "raw" export format (not a JWK).
  const exportedPublicKey = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey) as ArrayBuffer;
  const serverPublicKeyRaw = new Uint8Array(exportedPublicKey);

  // Import subscriber's public key
  const subscriberKey = await crypto.subtle.importKey(
    'raw', subscriberPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name:'ECDH', public: subscriberKey } as any, serverKeyPair.privateKey, 256)
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
): Promise<boolean> {
  try {
    const { ciphertext, salt, serverPublicKey } = await encryptPayload(plaintext, sub.p256dh, sub.auth_key);
    const body = buildBody(salt, serverPublicKey, ciphertext);

    const url = new URL(sub.endpoint);
    const jwt = await vapidJWT(`${url.protocol}//${url.host}`, env.VAPID_EMAIL, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

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
      await env.DB.prepare(env.PKR_PUSH_ROOMS_V2==='1'
        ?'DELETE FROM push_room_subscriptions WHERE endpoint=?'
        :'DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
      return false;
    }
    if (!res.ok) {
      console.error('Push failed', res.status, await res.text().catch(()=>''));
      return false;
    }
    return true; // Push service accepted; not proof the recipient received or read it.
  } catch(e) {
    console.error('Push send error', e);
    return false;
  }
}

/**
 * Self-test delivery only to a verified member's own registered device.
 * Acceptance by the push provider is not confirmation of phone display.
 */
export async function sendPushTestToDevice(
  env:Env,eventId:string,userId:string,endpoint:string
):Promise<boolean>{
  if(env.PKR_ENV==='staging'||env.PKR_PHONE_MEMBERS_V1!=='1'||!userId||!endpoint)return false;
  const table=env.PKR_PUSH_ROOMS_V2==='1'?'push_room_subscriptions':'push_subscriptions';
  const record=await env.DB.prepare(
    'SELECT s.endpoint,s.p256dh,s.auth_key FROM '+table+' s '+
    'JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id '+
    'WHERE s.event_id=? AND s.user_id=? AND s.endpoint=? LIMIT 1'
  ).bind(eventId,userId,endpoint).first<{endpoint:string;p256dh:string;auth_key:string}>();
  if(!record)return false;
  const payload=JSON.stringify({
    title:'🔔 PKR test — a real notification',
    body:'This alert came from the PKR server. Your phone controls its volume. Tap to open your poker room.',
    data:{type:'test',eventId,url:'/events/'+encodeURIComponent(eventId),
      notificationId:'self-test-'+Date.now()},
  });
  return sendToSub(env,record,payload);
}

/** Broadcast to ALL subscribers of an event */
export async function sendPushToEvent(env: Env, eventId: string, payload: PushPayload): Promise<number> {
  if (env.PKR_ENV === 'staging') return 0;
  const nativeAccepted=await sendNativePushToEvent(env,eventId,payload);
  const subs = await env.DB.prepare(
    env.PKR_PUSH_ROOMS_V2==='1'
      ?'SELECT s.endpoint,s.p256dh,s.auth_key FROM push_room_subscriptions s JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id WHERE s.event_id=?'
      :env.PKR_PHONE_MEMBERS_V1==='1'
      ?'SELECT s.endpoint,s.p256dh,s.auth_key FROM push_subscriptions s JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id WHERE s.event_id=?'
      :'SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE event_id=?'
  ).bind(eventId).all<{endpoint:string; p256dh:string; auth_key:string}>();
  if (!subs.results.length) return nativeAccepted;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  const delivered = await Promise.allSettled(subs.results.map(s => sendToSub(env, s, body)));
  return nativeAccepted+delivered.filter(r=>r.status==='fulfilled'&&r.value===true).length;
}

/**
 * Financial notifications must use an authenticated user ID, not matching
 * player names, phone numbers, or former group subscriptions. If a manually
 * seated guest is not linked to a verified room member, no private push is sent.
 * Delivery count means accepted by push service, not read by the recipient.
 */
export async function sendPushToAccount(
  env:Env,eventId:string,userId:string,payload:PushPayload
):Promise<number>{
  if(env.PKR_ENV==='staging'||env.PKR_PHONE_MEMBERS_V1!=='1'||
     env.PKR_PUSH_ROOMS_V2!=='1'||!userId)return 0;
  const nativeAccepted=await sendNativePushToAccount(env,eventId,userId,payload);
  const rows=await env.DB.prepare(
    'SELECT s.endpoint,s.p256dh,s.auth_key FROM push_room_subscriptions s '+
    'JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id '+
    'WHERE s.event_id=? AND s.user_id=?'
  ).bind(eventId,userId).all<{endpoint:string;p256dh:string;auth_key:string}>();
  const payloadBody=JSON.stringify({
    title:payload.title,body:payload.body,icon:'/icon-192.png',
    badge:'/icon-192.png',data:payload.data||{},
  });
  const outcomes=await Promise.allSettled(
    rows.results.map(sub=>sendToSub(env,sub,payloadBody))
  );
  return nativeAccepted+outcomes.filter(o=>o.status==='fulfilled'&&o.value===true).length;
}

/** Send push to a specific player by display_name within an event */
export async function sendPushToPlayer(env: Env, eventId: string, displayName: string, payload: PushPayload): Promise<number> {
  if (env.PKR_ENV === 'staging') return 0;
  const name = displayName.toLowerCase().trim();
  const firstName = name.split(/\s+/)[0];

  // V2 subscriptions are tied to authenticated event membership, with exact
  // member-name matching rather than fuzzy private financial notifications.
  if(env.PKR_PUSH_ROOMS_V2==='1'){
    const subs=await env.DB.prepare(
      "SELECT s.endpoint,s.p256dh,s.auth_key FROM push_room_subscriptions s " +
      "JOIN users u ON u.id=s.user_id " +
      "JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id " +
      "WHERE s.event_id=? AND LOWER(TRIM(u.name))=?"
    ).bind(eventId,name).all<{endpoint:string;p256dh:string;auth_key:string}>();
    if(!subs.results.length)return 0;
    const body=JSON.stringify({title:payload.title,body:payload.body,icon:'/icon-192.png',
      badge:'/icon-192.png',data:payload.data||{}});
    const results=await Promise.allSettled(subs.results.map(sub=>sendToSub(env,sub,body)));
    return results.filter(x=>x.status==='fulfilled'&&x.value===true).length;
  }

  // Legacy mode: match on exact/prefix/first-name, subject to membership flag.
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

  // Never notify a former member or an unauthenticated name-only subscriber.
  if(env.PKR_PHONE_MEMBERS_V1==='1'){
    const verified=await env.DB.prepare(
      'SELECT s.endpoint FROM push_subscriptions s JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id WHERE s.event_id=?'
    ).bind(eventId).all<{endpoint:string}>();
    const allowed=new Set(verified.results.map(v=>v.endpoint));
    subs.results=subs.results.filter(v=>allowed.has(v.endpoint));
  }
  if (!subs.results.length) return 0;
  const body = JSON.stringify({ title:payload.title, body:payload.body, icon:'/icon-192.png', badge:'/icon-192.png', data:payload.data||{} });
  const delivered=await Promise.allSettled(subs.results.map(s=>sendToSub(env,s,body)));
  return delivered.filter(x=>x.status==='fulfilled'&&x.value===true).length;
}

/**
 * Moderation alerts go only to authenticated room management accounts.
 * Do NOT use display-name matching here: invite requests and RSVPs are
 * private, and a caller-supplied subscriber user_id can be spoofed in the
 * legacy opt-in route when phone membership enforcement is disabled.
 */
async function sendPushToManagers(
  env: Env, eventId: string, roles: readonly string[], payload: PushPayload
): Promise<number> {
  if (env.PKR_ENV === 'staging' || env.PKR_PHONE_MEMBERS_V1 !== '1') return 0;
  const nativeAccepted=await sendNativePushToManagers(env,eventId,roles,payload);
  const table=env.PKR_PUSH_ROOMS_V2==='1'?'push_room_subscriptions':'push_subscriptions';
  const managerSql =
    "SELECT DISTINCT s.endpoint,s.p256dh,s.auth_key FROM "+table+" s " +
    "JOIN event_members em ON em.event_id=s.event_id AND em.user_id=s.user_id " +
    "WHERE s.event_id=? AND em.role IN (" + roles.map(() => '?').join(',') + ")";
  const subs = await env.DB.prepare(managerSql).bind(eventId,...roles).all<{endpoint:string;p256dh:string;auth_key:string}>();
  if (!subs.results.length) return nativeAccepted;
  const body = JSON.stringify({
    title:payload.title, body:payload.body, icon:'/icon-192.png',
    badge:'/icon-192.png',data:payload.data||{}
  });
  const results = await Promise.allSettled(subs.results.map(sub=>sendToSub(env,sub,body)));
  return nativeAccepted+results.filter(r=>r.status==='fulfilled'&&r.value===true).length;
}

/** Only the room owner can review and approve private membership requests. */
export function sendPushToHosts(env:Env,eventId:string,payload:PushPayload):Promise<number> {
  return sendPushToManagers(env,eventId,['host'],payload);
}

/** Host and co-host game management updates; never broadcast every RSVP to players. */
export function sendPushToModerators(env:Env,eventId:string,payload:PushPayload):Promise<number> {
  return sendPushToManagers(env,eventId,['host','cohost'],payload);
}
