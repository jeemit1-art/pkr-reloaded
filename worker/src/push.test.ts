import {describe,it,expect,vi,afterEach} from 'vitest';
import {vapidJWT,sendPushToPlayer} from './push';

function b64url(data:Uint8Array):string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function decode(value:string):Uint8Array {
  const s=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
}
async function fixture(){
  const keys=await crypto.subtle.generateKey(
    {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']) as CryptoKeyPair;
  const jwk=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const raw=await crypto.subtle.exportKey('raw',keys.publicKey);
  const pkcs8=await crypto.subtle.exportKey('pkcs8',keys.privateKey);
  return {keys,privateRaw:jwk.d!,publicRaw:b64url(new Uint8Array(raw)),
    privatePkcs8:b64url(new Uint8Array(pkcs8))};
}
afterEach(()=>vi.unstubAllGlobals());

describe('VAPID signing and push dispatch (synthetic keys and subscribers only)',()=>{
  it('signs ES256 JWT with a raw 32-byte private key from web-push',async()=>{
    const f=await fixture();
    expect(decode(f.privateRaw).length).toBe(32);
    const jwt=await vapidJWT('https://push.example.invalid','test@example.invalid',f.privateRaw,f.publicRaw);
    const [header,payload,signature]=jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(decode(header)))).toMatchObject({alg:'ES256'});
    const claims=JSON.parse(new TextDecoder().decode(decode(payload)));
    expect(claims.aud).toBe('https://push.example.invalid');
    expect(claims.sub).toBe('mailto:test@example.invalid');
    expect(await crypto.subtle.verify(
      {name:'ECDSA',hash:'SHA-256'},f.keys.publicKey,decode(signature),
      new TextEncoder().encode(header+'.'+payload))).toBe(true);
  });
  it('retains compatibility with a DER PKCS8 VAPID private key',async()=>{
    const f=await fixture();
    const jwt=await vapidJWT(
      'https://push.example.invalid','mailto:test@example.invalid',f.privatePkcs8,f.publicRaw);
    const [a,b,signature]=jwt.split('.');
    expect(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},f.keys.publicKey,
      decode(signature),new TextEncoder().encode(a+'.'+b))).toBe(true);
  });
  it('rejects malformed public keys for raw private scalars',async()=>{
    const f=await fixture();
    await expect(vapidJWT(
      'https://push.example.invalid','test@example.invalid',f.privateRaw,'AA'))
      .rejects.toThrow('Invalid VAPID public key');
  });
  it('encrypts the payload and counts only a successful push service response',async()=>{
    const f=await fixture();
    const subscriber=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},true,['deriveBits']) as CryptoKeyPair;
    const p256dh=b64url(new Uint8Array(await crypto.subtle.exportKey('raw',subscriber.publicKey)));
    const auth=b64url(crypto.getRandomValues(new Uint8Array(16)));
    const fetchMock=vi.fn(async(_url:string,opts:any)=>{
      expect(opts.headers['Content-Encoding']).toBe('aes128gcm');
      expect(opts.headers.Authorization).toContain('vapid t=');
      expect(opts.headers.Authorization).toContain('k='+f.publicRaw);
      expect(opts.body.byteLength).toBeGreaterThan(100);
      return new Response('',{status:201});
    });
    vi.stubGlobal('fetch',fetchMock);
    const env:any={PKR_ENV:'production',VAPID_PRIVATE_KEY:f.privateRaw,
      VAPID_PUBLIC_KEY:f.publicRaw,VAPID_EMAIL:'test@example.invalid',
      DB:{prepare:()=>({bind:()=>({all:async()=>({results:[{
        endpoint:'https://push.example.invalid/send/synthetic',p256dh,auth_key:auth,
      }]})})})}};
    const accepted=await sendPushToPlayer(env,'room','Synthetic Payer',{
      title:'Synthetic reminder',body:'Test only',data:{type:'payment_reminder'},
    });
    expect(accepted).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://push.example.invalid/send/synthetic');
  });
  it('never sends production push in staging',async()=>{
    const accepted=await sendPushToPlayer(
      {PKR_ENV:'staging'} as any,'r','p',{title:'Synthetic',body:'Test'});
    expect(accepted).toBe(0);
  });
});