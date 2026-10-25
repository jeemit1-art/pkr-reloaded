// Group-scoped private mobile identities. Never log or expose E.164 values except
// in host-authorized responses needed to open WhatsApp or send a verification.
import type {Env} from './types';

export function normalizeMobile(input:unknown):string|null {
  if(typeof input!=='string')return null;
  const clean=input.replace(/[()\s-]/g,'');
  let number=clean;
  // AU locals default to +61; international callers must supply country code.
  if(/^04\d{8}$/.test(clean))number='+61'+clean.slice(1);
  else if(/^614\d{8}$/.test(clean))number='+'+clean;
  if(!/^\+[1-9]\d{7,14}$/.test(number))return null;
  // Australian identifiers must be mobile numbers (04).
  if(number.startsWith('+61')&&!/^\+614\d{8}$/.test(number))return null;
  return number;
}
function keyMaterial(env:Env):Promise<CryptoKey> {
  if(!env.PKR_CONTACT_KEY||env.PKR_CONTACT_KEY.length<32)
    throw Error('Private contact encryption is not configured.');
  return crypto.subtle.importKey('raw',new TextEncoder().encode(env.PKR_CONTACT_KEY),
    'HKDF',false,['deriveKey']);
}
async function derived(env:Env,info:string,algorithm:'HMAC'|'AES-GCM'):Promise<CryptoKey>{
  const material=await keyMaterial(env);
  const salt=new TextEncoder().encode('PKR phone contacts v1, isolated secret');
  const params={name:'HKDF',hash:'SHA-256',salt,info:new TextEncoder().encode(info)};
  return crypto.subtle.deriveKey(params,material,
    algorithm==='HMAC'?{name:'HMAC',hash:'SHA-256',length:256}:{name:'AES-GCM',length:256},
    false,algorithm==='HMAC'?['sign']:['encrypt','decrypt']);
}
function hex(bytes:Uint8Array):string {
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function b64(bytes:Uint8Array):string {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s:string):Uint8Array {
  return Uint8Array.from(atob(s),x=>x.charCodeAt(0));
}
export async function phoneLookup(env:Env,scope:string,mobile:string):Promise<string>{
  const key=await derived(env,'lookup','HMAC');
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(scope+':'+mobile));
  return hex(new Uint8Array(signed));
}
export async function encryptPhone(env:Env,mobile:string):Promise<string>{
  const key=await derived(env,'encrypted-e164','AES-GCM');
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,new TextEncoder().encode(mobile));
  return b64(nonce)+'.'+b64(new Uint8Array(ciphertext));
}
export async function decryptPhone(env:Env,payload:string):Promise<string>{
  const [n,c]=payload.split('.');
  if(!n||!c)throw Error('Invalid encrypted contact');
  const key=await derived(env,'encrypted-e164','AES-GCM');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(n)},key,unb64(c));
  return new TextDecoder().decode(plain);
}
export function randomToken():string{
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export function maskMobile(mobile:string):string{
  return '•••• '+mobile.slice(-4);
}
export function phoneMembersReady(env:Env):boolean{
  return env.PKR_PHONE_MEMBERS_V1==='1'&&!!env.PKR_CONTACT_KEY&&env.PKR_CONTACT_KEY.length>=32;
}
export function verifyProviderReady(env:Env):boolean{
  return !!(env.TWILIO_VERIFY_SERVICE_SID&&env.TWILIO_API_KEY&&env.TWILIO_API_SECRET);
}
export async function twilioVerify(env:Env,action:'send'|'check',mobile:string,code?:string):Promise<boolean>{
  if(!verifyProviderReady(env))throw Error('Phone verification provider is not configured');
  const root='https://verify.twilio.com/v2/Services/'+encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID!);
  const path=action==='send'?'/Verifications':'/VerificationCheck';
  const body=new URLSearchParams(action==='send'
    ?{To:mobile,Channel:'whatsapp'}:{To:mobile,Code:code||''});
  const authorization='Basic '+btoa(env.TWILIO_API_KEY+':'+env.TWILIO_API_SECRET);
  const response=await fetch(root+path,{method:'POST',headers:{
    Authorization:authorization,'Content-Type':'application/x-www-form-urlencoded'
  },body:body.toString(),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return false;
  const data=await response.json() as {status?:string};
  return data.status===(action==='send'?'pending':'approved');
}
