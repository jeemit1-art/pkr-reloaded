// Rotating, device-scoped recovery for approved PKR accounts.
// Does not change member roles, stored games or financial records.
import type {Env} from './types';

const SESSION_SECONDS=45*24*60*60;
const PREFIX='pkr-device-session:';
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
async function keyFor(token:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return PREFIX+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function issueDeviceSession(env:Env,userId:string){
  if(!userId)throw new Error('Verified user is required');
  const refresh_token=randomToken();
  await env.KV.put(await keyFor(refresh_token),JSON.stringify({user_id:userId}),{expirationTtl:SESSION_SECONDS});
  return {refresh_token,expires_in:SESSION_SECONDS};
}
export async function renewDeviceSession(env:Env,refreshToken:string){
  if(!/^[a-f0-9]{64}$/.test(refreshToken))return null;
  const oldKey=await keyFor(refreshToken);
  const raw=await env.KV.get(oldKey);
  if(!raw)return null;
  let userId='';
  try{
    const record=JSON.parse(raw) as {user_id?:unknown};
    if(typeof record.user_id==='string')userId=record.user_id;
  }catch{}
  if(!userId)return null;
  // Store the replacement before revoking the old token, to avoid losing
  // recovery access in the event of an interrupted Cloudflare KV write.
  const updated=await issueDeviceSession(env,userId);
  await env.KV.delete(oldKey);
  return {user_id:userId,...updated};
}
export async function revokeDeviceSession(env:Env,refreshToken:string){
  if(!/^[a-f0-9]{64}$/.test(refreshToken))return;
  await env.KV.delete(await keyFor(refreshToken));
}
