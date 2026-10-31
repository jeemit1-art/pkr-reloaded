import type {Env} from './types';

/** Native iOS/Android push via Expo's hosted relay. All recipient selections
 * are verified server-side against current room membership. The web push
 * system remains separate and unchanged.
 */
type NativePayload={title:string;body:string;data?:Record<string,unknown>};
type NativeRecord={token:string;userId:string;eventId:string;platform:'ios'|'android'};
type Recipient={key:string;record:NativeRecord};
type PushReceipt={id:string;key:string;at:number};
const PREFIX='pkr:native-push:';
const RECEIPT_PREFIX='pkr:native-receipt:';
const EXPO_URL='https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL='https://exp.host/--/api/v2/push/getReceipts';
const TOKEN_PATTERN=/^(?:ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,128}\]$/;
const MAX_PER_ROOM=250;

export function nativePushReady(env:Env):boolean {
  return env.PKR_ENV!=='staging'&&env.PKR_NATIVE_PUSH_ENABLED==='1';
}
export function validNativeToken(token:unknown):token is string {
  return typeof token==='string'&&TOKEN_PATTERN.test(token);
}
async function hash(value:string):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
async function keyFor(eventId:string,userId:string,token:string):Promise<string>{
  return PREFIX+eventId+':'+userId+':'+await hash(token);
}
export async function registerNativeDevice(
  env:Env,eventId:string,userId:string,token:string,platform:'ios'|'android'
):Promise<void>{
  if(!nativePushReady(env))throw new Error('Native push not configured');
  const key=await keyFor(eventId,userId,token);
  await env.KV.put(key,JSON.stringify({token,userId,eventId,platform} satisfies NativeRecord),
    {expirationTtl:90*86400});
}
export async function unregisterNativeDevice(
  env:Env,eventId:string,userId:string,token:string
):Promise<void>{
  await env.KV.delete(await keyFor(eventId,userId,token));
}
export async function hasNativeDevice(env:Env,eventId:string,userId:string,token:string):Promise<boolean>{
  return !!await env.KV.get(await keyFor(eventId,userId,token));
}
async function recipients(env:Env,eventId:string,userId?:string,roles?:readonly string[]):Promise<Recipient[]> {
  if(!nativePushReady(env))return [];
  // Never trust a token-only record for a former member or a name match.
  const members=await env.DB.prepare('SELECT user_id,role FROM event_members WHERE event_id=?')
    .bind(eventId).all<{user_id:string;role:string}>();
  const allowed=new Set(members.results.filter(m=>
    (!userId||m.user_id===userId)&&(!roles||roles.includes(m.role))
  ).map(m=>m.user_id));
  if(!allowed.size)return [];
  const results:Recipient[]=[];
  let cursor:undefined|string=undefined;
  do{
    const page:{keys:Array<{name:string}>;list_complete:boolean;cursor?:string}=await env.KV.list({prefix:PREFIX+eventId+':',limit:1000,...(cursor?{cursor}:{})});
    for(const key of page.keys){
      if(results.length>=MAX_PER_ROOM)break;
      const raw=await env.KV.get(key.name);
      if(!raw)continue;
      try{
        const record=JSON.parse(raw) as NativeRecord;
        if(record.eventId!==eventId||!allowed.has(record.userId)||!validNativeToken(record.token))
          continue;
        if(key.name!==await keyFor(eventId,record.userId,record.token))continue;
        results.push({key:key.name,record});
      }catch{continue;}
    }
    if(results.length>=MAX_PER_ROOM)break;
    cursor=page.list_complete?undefined:page.cursor;
  }while(cursor);
  return results;
}
function message(payload:NativePayload,token:string){
  const d=payload.data||{};
  const route=typeof d.url==='string'&&d.url.startsWith('/')?d.url:'/instant';
  return {
    to:token,
    title:payload.title.slice(0,120),
    body:payload.body.slice(0,260),
    sound:'pkr-alert.wav',
    channelId:'pkr-game-updates',
    priority:'high',
    data:{type:typeof d.type==='string'?d.type:'pkr_update',
      eventId:typeof d.eventId==='string'?d.eventId:'',
      gameId:typeof d.gameId==='string'?d.gameId:'',
      url:route}
  };
}
async function sendBatch(env:Env,batch:Recipient[],payload:NativePayload):Promise<number>{
  const headers:Record<string,string>={
    'Content-Type':'application/json','Accept':'application/json'
  };
  if(env.EXPO_ACCESS_TOKEN)headers.Authorization='Bearer '+env.EXPO_ACCESS_TOKEN;
  try{
    const response=await fetch(EXPO_URL,{
      method:'POST',headers,body:JSON.stringify(batch.map(x=>message(payload,x.record.token)))
    });
    if(!response.ok){
      console.error('Native push relay rejected request',response.status);
      return 0;
    }
    const body=await response.json() as {data?:Array<{
      status?:string;id?:string;details?:{error?:string}
    }>};
    let accepted=0;
    for(let i=0;i<batch.length;i++){
      const ticket=body.data?.[i];
      if(ticket?.status==='ok'&&typeof ticket.id==='string'){
        accepted++;
        const stored:PushReceipt={id:ticket.id,key:batch[i].key,at:Date.now()};
        await env.KV.put(RECEIPT_PREFIX+ticket.id,JSON.stringify(stored),{expirationTtl:86400});
      }else if(ticket?.details?.error==='DeviceNotRegistered'){
        await env.KV.delete(batch[i].key);
      }
    }
    return accepted; // provider queue accepted, NOT proof of phone delivery.
  }catch(e){console.error('Native push relay network failure',e);return 0;}
}
async function deliver(env:Env,eventId:string,payload:NativePayload,userId?:string,roles?:readonly string[]):Promise<number>{
  if(!nativePushReady(env))return 0;
  const items=await recipients(env,eventId,userId,roles);
  let accepted=0;
  for(let i=0;i<items.length;i+=100)
    accepted+=await sendBatch(env,items.slice(i,i+100),payload);
  return accepted;
}
export const sendNativePushToEvent=(env:Env,eventId:string,payload:NativePayload)=>
  deliver(env,eventId,payload);
export const sendNativePushToAccount=(env:Env,eventId:string,userId:string,payload:NativePayload)=>
  deliver(env,eventId,payload,userId);
export const sendNativePushToManagers=(
  env:Env,eventId:string,roles:readonly string[],payload:NativePayload
)=>deliver(env,eventId,payload,undefined,roles);

export async function sendNativeSelfTest(
  env:Env,eventId:string,userId:string,token:string
):Promise<boolean>{
  if(!nativePushReady(env)||!await hasNativeDevice(env,eventId,userId,token))return false;
  const allowed=await env.DB.prepare(
    'SELECT 1 AS allowed FROM event_members WHERE event_id=? AND user_id=?'
  ).bind(eventId,userId).first();
  if(!allowed)return false;
  return (await sendBatch(env,[{
    key:await keyFor(eventId,userId,token),
    record:{eventId,userId,token,platform:'ios'}
  }],{
    title:'🔔 PKR native notification test',
    body:'A real notification from PKR. Open your poker room to verify it works.',
    data:{type:'test',eventId,url:'/instant?room='+encodeURIComponent(eventId)}
  }))>0;
}

/** Hourly best-effort ticket reconciliation. Removes invalid tokens; never
 * claims receipt status proves a phone displayed an alert.
 */
export async function reconcileNativeReceipts(env:Env):Promise<void>{
  if(!nativePushReady(env))return;
  let cursor:undefined|string=undefined;
  const due:PushReceipt[]=[];
  do{
    const page:{keys:Array<{name:string}>;list_complete:boolean;cursor?:string}=await env.KV.list({prefix:RECEIPT_PREFIX,limit:1000,...(cursor?{cursor}:{})});
    for(const item of page.keys){
      if(due.length>=800)break;
      const raw=await env.KV.get(item.name);
      if(!raw)continue;
      try{
        const r=JSON.parse(raw) as PushReceipt;
        if(Date.now()-r.at>=15*60000&&Date.now()-r.at<24*3600000&&r.id&&r.key.startsWith(PREFIX))
          due.push(r);
      }catch{}
    }
    if(due.length>=800)break;
    cursor=page.list_complete?undefined:page.cursor;
  }while(cursor);
  if(!due.length)return;
  for(let i=0;i<due.length;i+=1000){
    const batch=due.slice(i,i+1000);
    try{
      const headers:Record<string,string>={'Content-Type':'application/json'};
      if(env.EXPO_ACCESS_TOKEN)headers.Authorization='Bearer '+env.EXPO_ACCESS_TOKEN;
      const response=await fetch(EXPO_RECEIPTS_URL,{method:'POST',headers,
        body:JSON.stringify({ids:batch.map(r=>r.id)})});
      if(!response.ok)continue;
      const parsed=await response.json() as {data?:Record<string,{
        status?:string;details?:{error?:string}
      }>};
      for(const receipt of batch){
        const result=parsed.data?.[receipt.id];
        if(!result)continue;
        if(result.details?.error==='DeviceNotRegistered')
          await env.KV.delete(receipt.key);
        await env.KV.delete(RECEIPT_PREFIX+receipt.id);
      }
    }catch(e){console.error('Native push receipt lookup failed',e);}
  }
}
