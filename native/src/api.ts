import * as SecureStore from 'expo-secure-store';

export type Room={
  id:string;name:string;role?:string;status?:string;member_count?:number;game_count?:number
};
export type Player={id:string;name:string;email:string;avatar_url?:string|null};
export type Game={
  id:string;event_id:string;scheduled_at:number;location:string|null;
  seats:number;status:string;results_token:string|null
};
export type RsvpBoard={
  game:{id:string;status:string;seats:number;scheduled_at:number;location:string|null};
  event:{id:string;name:string};
  options:string[];
  guests:{id:string;display_name:string;arrival_option:string;status:string;
    seat_number:number|null}[];
  players:{display_name:string;seat_number:number}[];
};
export type JoinRequest={id:string;name:string;expected_member:string;phone:string;requested_at:number};

const KEY='pkr_native_session';
const BASE=(process.env.EXPO_PUBLIC_API_URL||'').replace(/\/$/,'');
function assertBase(){
  if(!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(BASE))
    throw new Error('PKR native API is not configured. Set EXPO_PUBLIC_API_URL to the production HTTPS Worker URL.');
}
export const getSession=()=>SecureStore.getItemAsync(KEY);
export const setSession=(jwt:string)=>SecureStore.setItemAsync(KEY,jwt);
export const clearSession=()=>SecureStore.deleteItemAsync(KEY);

async function raw<T>(
  path:string,options:{method?:'GET'|'POST'|'DELETE';body?:unknown;token?:string;retry?:boolean}={}
):Promise<T>{
  assertBase();
  const token=options.token===undefined?await getSession():options.token;
  const response=await fetch(BASE+path,{
    method:options.method||'GET',
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})
  });
  if(response.status===401 && options.retry!==false && token){
    const refreshed=await fetch(BASE+'/auth/refresh',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}
    }).catch(()=>null);
    if(refreshed?.ok){
      const newJwt=(await refreshed.json() as {token?:string}).token;
      if(newJwt){await setSession(newJwt);return raw<T>(path,{...options,token:newJwt,retry:false});}
    }
    throw new Error('Your PKR session expired. Restore your access with a new code.');
  }
  if(!response.ok){
    const data=await response.json().catch(()=>({})) as {error?:string};
    throw new Error(data.error||'PKR request failed ('+response.status+').');
  }
  return await response.json() as T;
}
export async function redeemTransferCode(code:string):Promise<void>{
  const normalized=code.toUpperCase().replace(/[\s-]/g,'');
  if(!/^[A-HJ-NP-Z2-9]{16}$/.test(normalized))
    throw new Error('Enter your 16-character transfer code.');
  const result=await raw<{token:string}>('/auth/transfer/redeem',{
    method:'POST',body:{code:normalized},token:'',retry:false
  });
  if(!result.token)throw new Error('The transfer code could not be verified.');
  await setSession(result.token);
}
export const getMe=()=>raw<Player>('/auth/me');
export const getRooms=()=>raw<Room[]>('/events');
export const getGames=(roomId:string)=>raw<Game[]>('/events/'+encodeURIComponent(roomId)+'/games');
export const getRsvp=(gameId:string)=>
  raw<RsvpBoard>('/games/'+encodeURIComponent(gameId)+'/rsvp-board');
export const saveRsvp=(gameId:string,body:{
  display_name:string;arrival_option:string;seat_number:number|null;edit_token?:string
})=>raw<{ok:boolean;edit_token?:string}>('/games/'+encodeURIComponent(gameId)+'/rsvp-board',{
  method:'POST',body
});
export const getJoinRequests=(roomId:string)=>
  raw<{requests:JoinRequest[]}>('/events/'+encodeURIComponent(roomId)+'/join-requests');
export const decideJoin=(roomId:string,requestId:string,approve:boolean)=>
  raw<{ok:boolean}>('/events/'+encodeURIComponent(roomId)+
    '/join-requests/'+encodeURIComponent(requestId)+'/decision',{method:'POST',body:{approve}});
export const inviteMember=(roomId:string,display_name:string,phone:string)=>
  raw<{whatsapp_url:string}>('/events/'+encodeURIComponent(roomId)+'/phone-contacts',{
    method:'POST',body:{display_name,phone,role:'member'}
});
export const registerNative=(roomId:string,token:string,platform:'ios'|'android')=>
  raw<{registered:boolean}>('/events/'+encodeURIComponent(roomId)+'/native-push',{
    method:'POST',body:{token,platform}
});
export const unregisterNative=(roomId:string,token:string)=>
  raw<{ok:boolean}>('/events/'+encodeURIComponent(roomId)+'/native-push',{
    method:'DELETE',body:{token}
});
export const testNative=(roomId:string,token:string)=>
  raw<{accepted:boolean;meaning:string}>('/events/'+encodeURIComponent(roomId)+'/native-test-push',{
    method:'POST',body:{token}
});
export const nativeRsvpKey=(gameId:string)=>'pkr_rsvp_'+gameId;
export const nativeOptInKey=(roomId:string)=>'pkr_alerts_'+roomId;
