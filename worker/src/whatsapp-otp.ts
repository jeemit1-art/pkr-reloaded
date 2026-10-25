// Direct Meta WhatsApp Business Cloud API OTP delivery; no Twilio dependency.
// Keyed OTP hashes live in the existing D1 phone_verification_limits table.
import type {Env} from './types';
import {phoneLookup} from './phone-security';

const TTL=600;
const MAX_ATTEMPTS=5;
type OtpRow={rate_key:string;window_start:number;attempts:number};

export function whatsappOtpReady(env:Env):boolean{
  const version=env.META_WHATSAPP_API_VERSION||'v24.0';
  return !!(
    env.PKR_CONTACT_KEY&&env.PKR_CONTACT_KEY.length>=32&&
    env.META_WHATSAPP_ACCESS_TOKEN&&
    env.META_WHATSAPP_PHONE_NUMBER_ID&&
    /^\d{8,25}$/.test(env.META_WHATSAPP_PHONE_NUMBER_ID)&&
    env.META_WHATSAPP_AUTH_TEMPLATE&&
    /^[a-z0-9_]{1,512}$/.test(env.META_WHATSAPP_AUTH_TEMPLATE)&&
    /^v\d{1,3}\.\d$/.test(version)
  );
}
function code6():string{
  const bytes=new Uint32Array(1);
  const limit=Math.floor(0x100000000/1000000)*1000000;
  do{crypto.getRandomValues(bytes);}while(bytes[0]>=limit);
  return String(bytes[0]%1000000).padStart(6,'0');
}
async function prefixFor(env:Env,mobile:string,scope:string):Promise<string>{
  // Both the phone and invitation/login challenge are hidden by the HMAC.
  return 'wa-otp:'+await phoneLookup(env,'wa-otp-scope',scope+':'+mobile)+':';
}
async function codeKey(env:Env,prefix:string,code:string):Promise<string>{
  return prefix+await phoneLookup(env,'wa-otp-code',prefix+code);
}
function equalHash(a:string,b:string):boolean{
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
async function sendTemplate(env:Env,mobile:string,code:string):Promise<boolean>{
  const version=env.META_WHATSAPP_API_VERSION||'v24.0';
  const response=await fetch(
    'https://graph.facebook.com/'+version+'/'+env.META_WHATSAPP_PHONE_NUMBER_ID+'/messages',
    {method:'POST',headers:{
      Authorization:'Bearer '+env.META_WHATSAPP_ACCESS_TOKEN,
      'Content-Type':'application/json',
    },body:JSON.stringify({
      messaging_product:'whatsapp',recipient_type:'individual',
      to:mobile.slice(1),type:'template',
      template:{
        name:env.META_WHATSAPP_AUTH_TEMPLATE,
        language:{code:env.META_WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},
        components:[
          {type:'body',parameters:[{type:'text',text:code}]},
          {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}]},
        ],
      },
    }),signal:AbortSignal.timeout(12000)}
  );
  if(!response.ok)return false;
  const result=await response.json() as {messages?:Array<{id?:unknown}>};
  // Accepted by Meta is not the same as delivered in WhatsApp.
  return typeof result.messages?.[0]?.id==='string';
}

export async function sendWhatsappOtp(env:Env,mobile:string,scope:string):Promise<boolean>{
  if(!whatsappOtpReady(env)||!/^(invite|login):[a-zA-Z0-9_-]{1,128}$/.test(scope))return false;
  const prefix=await prefixFor(env,mobile,scope);
  const code=code6(),key=await codeKey(env,prefix,code);
  // D1 is strongly consistent; cross-region KV would not be appropriate for OTP.
  // Revokes all previous unredeemed codes for this exact invite/login scope.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM phone_verification_limits WHERE rate_key LIKE ?')
      .bind(prefix+'%'),
    env.DB.prepare(
      'INSERT INTO phone_verification_limits(rate_key,window_start,attempts) VALUES (?,unixepoch(),0)'
    ).bind(key),
  ]);
  let sent=false;
  try{sent=await sendTemplate(env,mobile,code);}
  catch{/* Do not expose Meta's response or a verification code. */}
  if(!sent)await env.DB.prepare(
    'DELETE FROM phone_verification_limits WHERE rate_key=?'
  ).bind(key).run();
  return sent;
}

export async function checkWhatsappOtp(env:Env,mobile:string,code:string,scope:string):Promise<boolean>{
  if(!whatsappOtpReady(env)||!/^\d{6}$/.test(code)||
    !/^(invite|login):[a-zA-Z0-9_-]{1,128}$/.test(scope))return false;
  const prefix=await prefixFor(env,mobile,scope);
  const row=await env.DB.prepare(
    'SELECT rate_key,window_start,attempts FROM phone_verification_limits WHERE rate_key LIKE ? LIMIT 1'
  ).bind(prefix+'%').first<OtpRow>();
  const now=Math.floor(Date.now()/1000);
  if(!row||!Number.isSafeInteger(row.attempts)||row.attempts>=MAX_ATTEMPTS||
    !Number.isSafeInteger(row.window_start)||row.window_start<=now-TTL)return false;
  const expected=await codeKey(env,prefix,code);
  if(!equalHash(row.rate_key,expected)){
    await env.DB.prepare(
      'UPDATE phone_verification_limits SET attempts=attempts+1 WHERE rate_key=? AND attempts<?'
    ).bind(row.rate_key,MAX_ATTEMPTS).run();
    return false;
  }
  // The challenge can only be consumed once, even under concurrent confirms.
  const consumed=await env.DB.prepare(
    'DELETE FROM phone_verification_limits WHERE rate_key=? AND attempts<? AND window_start>unixepoch()-?'
  ).bind(row.rate_key,MAX_ATTEMPTS,TTL).run();
  return consumed.meta.changes===1;
}
