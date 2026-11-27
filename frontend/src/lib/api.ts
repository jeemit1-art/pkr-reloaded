// frontend/src/lib/api.ts — FULL REPLACEMENT
// Key changes:
//  - User type has plan fields
//  - req() fires 'pkr:upgrade_required' CustomEvent on 402 (catches all gated actions)
//  - api.billing added for checkout/portal/plan
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pkr_token');
}
export function saveToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem('pkr_token', token);
}
const deviceKey='pkr_approved_device_refresh_v1';
// The current installation retains an approved device credential for a limited
// period, independently of the shorter-lived seven-day access JWT.
let renewingDevice:Promise<boolean>|null=null;
async function performDeviceRenewal():Promise<boolean>{
  if(typeof window==='undefined')return false;
  const credential=localStorage.getItem(deviceKey);
  if(!credential)return false;
  try{
    const result=await fetch(API+'/auth/device-session/renew',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:credential}),
    });
    if(!result.ok){
      if(result.status===401&&localStorage.getItem(deviceKey)===credential)localStorage.removeItem(deviceKey);
      return false;
    }
    const data=await result.json() as {token?:string;refresh_token?:string};
    if(!data.token||!data.refresh_token)return false;
    // Replace the old token only after the server confirms both credentials.
    localStorage.setItem(deviceKey,data.refresh_token);
    saveToken(data.token);
    return true;
  }catch{return false;}
}
export function renewApprovedDevice():Promise<boolean>{
  if(renewingDevice)return renewingDevice;
  renewingDevice=performDeviceRenewal().finally(()=>{renewingDevice=null;});
  return renewingDevice;
}
export function hasApprovedDeviceCredential():boolean{
  if(typeof window==='undefined')return false;
  try{return !!localStorage.getItem(deviceKey);}catch{return false;}
}
export async function ensureApprovedDevice():Promise<boolean>{
  if(typeof window==='undefined')return false;
  if(localStorage.getItem(deviceKey))return true;
  return rememberApprovedDevice();
}
let rememberingDevice:Promise<boolean>|null=null;
export function rememberApprovedDevice():Promise<boolean>{
  if(rememberingDevice)return rememberingDevice;
  rememberingDevice=performRememberApprovedDevice().finally(()=>{rememberingDevice=null;});
  return rememberingDevice;
}
async function performRememberApprovedDevice():Promise<boolean>{
  if(typeof window==='undefined'||!getToken())return false;
  const previous=localStorage.getItem(deviceKey);
  try{
    const res=await fetch(API+'/auth/device-session/start',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getToken()},
    });
    if(!res.ok)return false;
    const data=await res.json() as {refresh_token?:string};
    if(!data.refresh_token)return false;
    localStorage.setItem(deviceKey,data.refresh_token);
    if(previous&&previous!==data.refresh_token){
      void fetch(API+'/auth/device-session/revoke',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:previous}),
      }).catch(()=>{});
    }
    return true;
  }catch{return false;}
}
export function clearToken() {
  if (typeof window === 'undefined')return;
  localStorage.removeItem('pkr_token');
  const credential=localStorage.getItem(deviceKey);
  localStorage.removeItem(deviceKey);
  if(credential)void fetch(API+'/auth/device-session/revoke',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:credential}),
  }).catch(()=>{});
}

async function req<T>(path: string, opts?: RequestInit, isRetry=false): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts, credentials:'include',
    headers:{
      'Content-Type':'application/json',
      ...(token ? {'Authorization':`Bearer ${token}`} : {}),
      ...opts?.headers,
    },
  });

  // If the access JWT has expired, use the approved device credential once.
  // Do not redirect while a valid device can still renew its session.
  if(res.status===401&&!isRetry&&getToken()){
    if(await renewApprovedDevice())return req<T>(path,opts,true);
    // A temporary network or Worker error must not revoke a valid device
    // session. Preserve credentials and let the member retry later.
    if(hasApprovedDeviceCredential())
      throw new Error('PKR could not verify your saved sign-in. Check your connection and retry; do not reinstall the app.');
    clearToken();
    if(typeof window!=='undefined'&&!window.location.pathname.startsWith('/mobile-login'))
      window.location.assign('/mobile-login?help=recover');
    throw new Error('Your PKR session expired. Use the member access guide to return to your existing account.');
  }

  // 402 Payment Required — fire global upgrade event so any component can show the modal
  if (res.status === 402) {
    const data = await res.json().catch(() => ({ error: 'Upgrade required', code: 'UPGRADE_REQUIRED' }));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pkr:upgrade_required', { detail: data }));
    }
    throw new Error(data.error || 'Upgrade required');
  }

  if (!res.ok) { const e = await res.json().catch(()=>({error:'Request failed'})); throw new Error(e.error||`HTTP ${res.status}`); }
  const result = await res.json();
  // Foreground financial confirmations are based on a successful server write.
  // They never imply that a payment has been transferred.
  if(typeof window!=='undefined' && (opts?.method==='PUT'||opts?.method==='POST')){
    const gameId=path.match(/^\/games\/([^/]+)/)?.[1];
    const kind= /\/buyin\//.test(path)?'buyin':
      /\/cashout\//.test(path)?'cashout':
      /\/settle$/.test(path)?'settlement':null;
    if(kind&&gameId)window.dispatchEvent(new CustomEvent('pkr:financial-update',{
      detail:{kind,gameId,at:Date.now()}
    }));
  }
  return result;
}

// Public fetch — no auth token
async function pub<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers:{'Content-Type':'application/json',...opts?.headers},
  });
  if (!res.ok) { const e = await res.json().catch(()=>({error:'Request failed'})); throw new Error(e.error||`HTTP ${res.status}`); }
  return res.json();
}

export interface PrivateGroupContact {id:string;display_name:string;phone:string;user_id?:string|null;status:'joined'|'invited'|'awaiting_host_approval'|'approved_awaiting_member'|'removed'|'expired';returning?:boolean;created_at?:number}

export const api = {
  phoneInvites: {
    requestApproval:(token:string,display_name:string)=>pub<{claim:string;status:string}>(`/phone-invites/${encodeURIComponent(token)}/request-approval`,{method:'POST',body:JSON.stringify({display_name})}),
    completeApproval:(claim:string,invite_token?:string)=>pub<{ok:boolean;token:string;event_id:string;status?:string}>('/phone-invites/complete-approval',{method:'POST',body:JSON.stringify({claim,invite_token})}),
    preview: (token:string)=>pub<{event_name:string;masked_phone:string;role:string;expires_at:number;approval_required:true;delivery:'manual_whatsapp'}>(`/phone-invites/${encodeURIComponent(token)}`),
  },
  auth: {
    me:       () => req<User>('/auth/me'),
    logout:   () => req('/auth/logout',{method:'POST'}),
    loginUrl: () => `${API}/auth/google`,
    transferStart:()=>req<{code:string;expires_in:number}>('/auth/transfer/start',{method:'POST'}),
    transferRedeem:(code:string)=>pub<{token:string}>('/auth/transfer/redeem',{
      method:'POST',body:JSON.stringify({code})
    }),
    refresh:  () => req<{token:string}>('/auth/refresh',{method:'POST'}),
  },
  events: {
    list:           ()               => req<Event[]>('/events'),
    get:            (id:string)      => req<EventDetail>(`/events/${id}`),
    settlementLedger:(id:string)=>req<RoomLedgerData>(`/events/${encodeURIComponent(id)}/settlement-ledger`),
    dashboardLayout:(id:string)=>req<RoomDashboardLayoutRecord>(`/events/${encodeURIComponent(id)}/dashboard-layout`),
    saveDashboardLayout:(id:string,layout:RoomDashboardLayout)=>req<RoomDashboardLayoutRecord>(
      `/events/${encodeURIComponent(id)}/dashboard-layout`,
      {method:'PUT',body:JSON.stringify({layout})}),
    create:         (d:any)          => req<Event>('/events',{method:'POST',body:JSON.stringify(d)}),
    update:         (id:string,d:any)=> req(`/events/${id}`,{method:'PUT',body:JSON.stringify(d)}),
    end:            (id:string)      => req<{ok:boolean}>(`/events/${id}/end`,{method:'POST'}),
    reopen:         (id:string)      => req<{ok:boolean}>(`/events/${id}/reopen`,{method:'POST'}),
    invite:         (id:string,role:string,email:string) => req<{token:string;url:string;role:string;recipient_email:string}>(`/events/${id}/invite`,{method:'POST',body:JSON.stringify({role,email})}),
    recoverContact:(id:string,contactId:string)=>req<{ok:boolean;url:string;whatsapp_url:string}>(`/events/${id}/phone-contacts/${contactId}/recovery`,{method:'POST'}),
    joinRequests:(id:string)=>req<{requests:Array<{id:string;name:string;expected_member:string;phone:string;requested_at:number;recovery?:boolean;rejoin?:boolean;contact_id?:string}>}>(`/events/${id}/join-requests`,{cache:'no-store'}),
    decideJoin:(id:string,requestId:string,approve:boolean)=>req<{ok:boolean;approved:boolean;contact_id?:string}>(`/events/${id}/join-requests/${requestId}/decision`,{method:'POST',body:JSON.stringify({approve})}),
    phoneContacts:  (id:string) => req<{contacts:PrivateGroupContact[]}>(`/events/${id}/phone-contacts`,{cache:'no-store'}),
    inviteByPhone:  (id:string,d:{display_name:string;phone:string;role:'member'|'cohost'}) =>
      req<{ok:boolean;contact:PrivateGroupContact;whatsapp_url:string;invite:{url:string;expires_at:number;role:string}}>(`/events/${id}/phone-contacts`,{method:'POST',body:JSON.stringify(d)}),
    linkPhoneContact:(id:string,contactId:string,userId:string)=>req<{ok:boolean;status:'joined';user_id:string}>(
      '/events/'+encodeURIComponent(id)+'/phone-contacts/'+encodeURIComponent(contactId)+'/link-member',
      {method:'POST',body:JSON.stringify({user_id:userId})}),
    removePhoneContact:(id:string,contactId:string)=>req<{ok:boolean}>(`/events/${id}/phone-contacts/${contactId}`,{method:'DELETE'}),
    redeemInvite:   (token:string)   => req<{ok:boolean;event:Event;role:string}>(`/events/invite/${token}`),
    pushRegistrations:(eventId:string)=>req<{members:Array<{user_id:string;device_count:number}>;definition:string}>(`/events/${eventId}/push-registrations`),
    pushStatus:     (eventId:string,endpoint:string)=>req<{subscribed:boolean}>(`/events/${eventId}/subscribe-status`,{
      method:'POST',body:JSON.stringify({endpoint})
    }),
    testPush:       (eventId:string,endpoint:string) =>
      req<{accepted:boolean;meaning:string}>(`/events/${encodeURIComponent(eventId)}/test-push`,{
        method:'POST',body:JSON.stringify({endpoint})
      }),
    subscribe:      (eventId:string,sub:any,userId?:string,displayName?:string) =>
      req(`/events/${eventId}/subscribe`,{method:'POST',body:JSON.stringify({...sub,userId,display_name:displayName})}),
    unsubscribe:    (eventId:string,endpoint:string) =>
      req(`/events/${eventId}/unsubscribe`,{method:'POST',body:JSON.stringify({endpoint})}),
    leaderboard:    (id:string)      => req<LeaderboardEntry[]>(`/events/${id}/leaderboard`),
    history:        (id:string)      => req<Game[]>(`/events/${id}/history`),
    deleteGame:     (gameId:string)  => req<{ok:boolean}>(`/games/${gameId}`,{method:'DELETE'}),
    players:        (id:string)      => req<EventPlayer[]>(`/events/${id}/players`),
    historicalVisibility:(id:string)=>req<{hidden_names:string[]}>('/events/'+encodeURIComponent(id)+'/historical-player-visibility'),
    setHistoricalVisibility:(id:string,name:string,hidden:boolean)=>
      req<{hidden_names:string[]}>('/events/'+encodeURIComponent(id)+'/historical-player-visibility',
        {method:'PUT',body:JSON.stringify({name,hidden})}),
    profiles:       (id:string)      => req<{profiles:RoomPlayerProfile[]}>(`/events/${id}/profiles`),
    saveProfile:    (id:string,profile:RoomPlayerProfileInput) =>
      req<{ok:boolean;profile:RoomPlayerProfile}>(`/events/${id}/profiles`,{method:'PUT',body:JSON.stringify(profile)}),
    verifyPassword: (id:string,password:string) =>
      req<{ok:boolean;required:boolean}>(`/events/${id}/verify-password`,{method:'POST',body:JSON.stringify({password})}),
    playerMerges: (id:string) =>
      req<{merges:RoomPlayerMerge[]}>(`/events/${id}/players/merges`),
    mergePlayers: (id:string,from:LeaderboardEntry,to:LeaderboardEntry) =>
      req<{ok:boolean;merge:RoomPlayerMerge;leaders:LeaderboardEntry[]}>(
        `/events/${id}/players/merge`,{method:'POST',body:JSON.stringify({
          from_user_id:from.user_id,to_user_id:to.user_id,
          from_games:from.games_played,to_games:to.games_played,
          from_net:from.total_net,to_net:to.total_net,confirm_same_person:true,
        })}),
    undoPlayerMerge: (id:string,fromUserId:string) =>
      req<{ok:boolean;leaders:LeaderboardEntry[]}>(`/events/${id}/players/merge/${encodeURIComponent(fromUserId)}`,{
        method:'DELETE',
      }),
  removeMember: (id:string, userId:string) => req(`/events/${id}/members/${userId}`,{method:'DELETE'}),
  },
  games: {
    list:     (eventId:string,status?:string) => req<Game[]>(`/events/${eventId}/games${status?`?status=${status}`:''}`),
    get:      (id:string)         => req<GameDetail>(`/games/${id}`),
    lobby:    (id:string)         => req<LobbyData>(`/games/${id}/lobby`),
    live:     (token:string)      => req<LiveData>(`/games/live/${token}`),
    results:  (token:string)      => req<ResultsData>(`/games/results/${token}`),
    create:   (eventId:string,d:any) => req<Game>(`/events/${eventId}/games`,{method:'POST',body:JSON.stringify(d)}),
    update:   (id:string,d:any)   => req(`/games/${id}`,{method:'PUT',body:JSON.stringify(d)}),
    settle:   (id:string,d:any)   => req<SettlementResult>(`/games/${id}/settle`,{method:'POST',body:JSON.stringify(d)}),
    start:    (id:string,password?:string) => req(`/games/${id}/start`,{method:'POST',body:JSON.stringify({password:password||''})}),
    rsvp:     (id:string,d:any)   => pub<{ok:boolean;rsvps:Rsvp[]}>(`/games/${id}/rsvp`,{method:'POST',body:JSON.stringify(d)}),
    rsvpBoard:(id:string)=>req<RsvpBoardData>('/games/'+id+'/rsvp-board'),
    submitRsvpBoard:(id:string,body:{display_name:string;arrival_option:string;seat_number:number|null;edit_token?:string})=>
      req<RsvpBoardReceipt>('/games/'+id+'/rsvp-board',{method:'POST',body:JSON.stringify(body)}),
    setRsvpTimes:(id:string,options:string[],responses?:RsvpReplyChoice[])=>
      req<{ok:boolean;options:string[];responses:RsvpReplyChoice[]}>('/games/'+id+'/rsvp-arrivals',{
        method:'PUT',body:JSON.stringify(responses===undefined?{options}:{options,responses}),
      }),
    seat:     (id:string,d:any)   => req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/seat`,{method:'POST',body:JSON.stringify(d)}),
    removeSeat:(id:string,userId:string,expectedSeatNumber:number|null) =>
      req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/seat/${userId}`,{
        method:'DELETE',body:JSON.stringify({expected_seat_number:expectedSeatNumber})}),
    buyin:    (id:string,userId:string,values:{
      count:number;total:number;expected_count:number;expected_total:number
    }) => req<{ok:boolean;buy_ins:number;buy_in_total:number}>(`/games/${id}/buyin/${userId}`,{method:'PUT',body:JSON.stringify(values)}),
    cashout:  (id:string,userId:string,cashout:number|null,expectedCashout:number|null) =>
      req<{ok:boolean;cashout:number|null}>(`/games/${id}/cashout/${userId}`,{
        method:'PUT',body:JSON.stringify({cashout,expected_cashout:expectedCashout})}),
    markPaid: (token:string,tid:string) => pub<{ok:boolean}>(`/games/results/${token}/transfers/${tid}/paid`,{method:'POST'}),
    setTransferStatus: (gameId:string,tid:string,status:'owed'|'paid'|'not_received') => req<{ok:boolean}>(`/games/${gameId}/transfers/${tid}/status`,{method:'PUT',body:JSON.stringify({status})}),
    settlementControl: (id:string) => req<{game_id:string;enabled:boolean;reminders_enabled:boolean;last_broadcast_at:number|null;outstanding_count:number;can_manage:boolean}>(`/games/${id}/settlement-control`),
    broadcastSettlement: (id:string,reminders_enabled:boolean) => req<{ok:boolean;transfers:number;push_accepted:number;recipients_without_accepted_push:number}>(`/games/${id}/settlement-control/broadcast`,{
      method:'POST',body:JSON.stringify({reminders_enabled}),
    }),
    settlementReminders: (id:string,enabled:boolean) => req<{ok:boolean;reminders_enabled:boolean}>(`/games/${id}/settlement-control/reminders`,{
      method:'PUT',body:JSON.stringify({enabled}),
    }),
    respondToTransfer: (id:string,tid:string,action:'sent'|'received'|'not_received') => req<{ok:boolean;status:string}>(`/games/${id}/transfers/${tid}/respond`,{
      method:'POST',body:JSON.stringify({action}),
    }),
    bulkTransferStatus: (id:string,ids:string[],status:'owed'|'paid') => req<{ok:boolean;updated:number;status:string}>(`/games/${id}/transfers/bulk-status`,{
      method:'POST',body:JSON.stringify({ids,status}),
    }),
    unsettle: (id:string) => req<{ok:boolean;message:string}>(`/games/${id}/unsettle`,{method:'POST'}),
    cancel:   (id:string) => req<{ok:boolean;message:string}>(`/games/${id}/cancel`,{method:'POST'}),
    delete:   (id:string) => req<{ok:boolean}>(`/games/${id}`,{method:'DELETE'}),
  },
  club: {
    polls: (eventId:string)=>req<{polls:ClubDatePoll[]}>(
      '/events/'+encodeURIComponent(eventId)+'/date-polls'),
    createPoll:(eventId:string,d:{title:string;options:number[];closes_at:number})=>
      req<{ok:boolean;id:string}>('/events/'+encodeURIComponent(eventId)+'/date-polls',
        {method:'POST',body:JSON.stringify(d)}),
    vote:(eventId:string,pollId:string,option_index:number)=>
      req<{ok:boolean;option_index:number}>('/events/'+encodeURIComponent(eventId)+
        '/date-polls/'+encodeURIComponent(pollId)+'/vote',
        {method:'PUT',body:JSON.stringify({option_index})}),
    closePoll:(eventId:string,pollId:string,selected_index:number|null)=>
      req<{ok:boolean;winning_date:number|null}>('/events/'+encodeURIComponent(eventId)+
        '/date-polls/'+encodeURIComponent(pollId)+'/close',
        {method:'POST',body:JSON.stringify({selected_index})}),
    waitlist:(gameId:string)=>req<ClubWaitlist>(
      '/games/'+encodeURIComponent(gameId)+'/waitlist'),
    joinWaitlist:(gameId:string)=>req<{ok:boolean;status:string}>(
      '/games/'+encodeURIComponent(gameId)+'/waitlist',{method:'POST'}),
    leaveWaitlist:(gameId:string)=>req<{ok:boolean}>(
      '/games/'+encodeURIComponent(gameId)+'/waitlist',{method:'DELETE'}),
    offerWaitlist:(gameId:string)=>req<{ok:boolean;offered:boolean;note:string}>(
      '/games/'+encodeURIComponent(gameId)+'/waitlist/offer-next',{method:'POST'}),
    memberRequests:(gameId:string)=>req<ClubMemberRequests>(
      '/games/'+encodeURIComponent(gameId)+'/member-requests'),
    createRequest:(gameId:string,d:{kind:ClubMemberRequestKind;note?:string})=>
      req<{ok:boolean;id:string;status:string}>(
        '/games/'+encodeURIComponent(gameId)+'/member-requests',
        {method:'POST',body:JSON.stringify(d)}),
    reviewRequest:(gameId:string,requestId:string,status:'approved'|'declined'|'resolved')=>
      req<{ok:boolean;status:string}>(
        '/games/'+encodeURIComponent(gameId)+'/member-requests/'+encodeURIComponent(requestId),
        {method:'PUT',body:JSON.stringify({status})}),
    seasons:(eventId:string)=>req<{seasons:ClubLeagueSeason[]}>(
      '/events/'+encodeURIComponent(eventId)+'/seasons'),
    createSeason:(eventId:string,d:{name:string;starts_at:number;ends_at:number;points:ClubLeaguePoints})=>
      req<{ok:boolean;id:string}>('/events/'+encodeURIComponent(eventId)+'/seasons',
        {method:'POST',body:JSON.stringify(d)}),
    seasonStandings:(eventId:string,seasonId:string)=>req<ClubSeasonStandings>(
      '/events/'+encodeURIComponent(eventId)+'/seasons/'+encodeURIComponent(seasonId)+'/standings'),
  },
  clubExtras:{
    expenseList:(id:string)=>req<ClubExpenseList>('/events/'+encodeURIComponent(id)+'/shared-expenses'),
    propose:(id:string,data:{game_id?:string|null;category:'food'|'venue'|'supplies'|'other';
       title:string;notes?:string;amount_cents:number;paid_by_user_id:string;member_ids:string[]})=>
      req<{ok:boolean;id:string}>('/events/'+encodeURIComponent(id)+'/shared-expenses',
      {method:'POST',body:JSON.stringify(data)}),
    respond:(id:string,expenseId:string,status:'accepted'|'declined')=>
      req<{ok:boolean;status:string}>('/events/'+encodeURIComponent(id)+'/shared-expenses/'+
      encodeURIComponent(expenseId)+'/respond',{method:'PUT',body:JSON.stringify({status})}),
    cancel:(id:string,expenseId:string)=>req<{ok:boolean}>('/events/'+encodeURIComponent(id)+
      '/shared-expenses/'+encodeURIComponent(expenseId)+'/cancel',{method:'POST'}),
    exportPage:(id:string,kind:ClubExportKind,offset:number)=>req<ClubExportPage>(
      '/events/'+encodeURIComponent(id)+'/data-export?kind='+encodeURIComponent(kind)+'&offset='+offset),
    presets:(id:string)=>req<{presets:ClubTournamentPreset[]}>(
      '/events/'+encodeURIComponent(id)+'/tournament-presets'),
    savePreset:(id:string,name:string,config:ClubTournamentConfig)=>
      req<{ok:boolean;id:string}>('/events/'+encodeURIComponent(id)+'/tournament-presets',
      {method:'POST',body:JSON.stringify({name,config})}),
    deletePreset:(id:string,presetId:string)=>req<{ok:boolean}>(
      '/events/'+encodeURIComponent(id)+'/tournament-presets/'+encodeURIComponent(presetId),
      {method:'DELETE'}),
    getTournament:(gameId:string)=>req<ClubGameTournament>('/games/'+encodeURIComponent(gameId)+'/tournament'),
    applyPreset:(gameId:string,config:ClubTournamentConfig)=>req<{ok:boolean;levels:number}>(
      '/games/'+encodeURIComponent(gameId)+'/tournament/setup',
      {method:'POST',body:JSON.stringify(config)}),
  },
  billing: {
    plan:     () => req<PlanStatus>('/billing/plan'),
    checkout: (plan: 'starter' | 'pro') =>
      req<{url:string}>('/billing/checkout',{method:'POST',body:JSON.stringify({plan})}),
    portal:   () => req<{url:string}>('/billing/portal',{method:'POST'}),
  },
  vapidKey: () => req<{key:string}>('/vapid-public-key'),
};

// ── Types ──
export interface PlanStatus {
  plan: 'trial' | 'starter' | 'pro' | 'lifetime';
  trial_active: boolean;
  free_game_available?:boolean;
  free_game_in_progress?:boolean;
  trial_days_left: number;
  trial_end: number;
  plan_expires_at: number | null;
  is_active: boolean;
  has_payment: boolean;
  max_groups: number | null;
  max_seats: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  // Plan fields (from updated /auth/me)
  plan: 'trial' | 'starter' | 'pro' | 'lifetime';
  trial_active: boolean;
  trial_days_left: number;
  is_active: boolean;
  free_game_available?:boolean;
  free_game_in_progress?:boolean;
}

export interface Event {
  id:string; name:string; description:string|null; buy_in:number;
  host_id:string; created_at:number; role?:string; member_count?:number; game_count?:number;
  status?: string;
}
export interface EventMember { id:string; name:string; avatar_url:string|null; email?:string; role:string; joined_at:number; }
export interface RoomPlayerProfile {
  profile_key:string;
  screen_name:string|null;
  avatar_data:string|null;
  avatar_emoji:string|null;
  phone:string|null;
  preferred_contact:'none'|'whatsapp'|'sms'|'email';
  private_notes:string|null;
  updated_at?:number;
}
export type RoomPlayerProfileInput = Omit<RoomPlayerProfile,'updated_at'>;

export interface EventDetail extends Event { members:EventMember[]; }
export interface EventPlayer { id:string; event_id:string; display_name:string; whatsapp:string|null; games_played:number; }
export interface Game {
  id:string; event_id:string; scheduled_at:number; location:string|null; notes:string|null;
  seats:number; status:string; live_token:string|null;
  results_token:string|null; created_at:number; player_count?:number; variance?:number|null;
}
export interface Rsvp { id:string; game_id:string; display_name:string; whatsapp:string|null; status:string; created_at:number; }
export interface GamePlayer {
  game_id:string; user_id:string; display_name:string; whatsapp:string|null;
  seat_number:number|null; buy_ins:number; buy_in_total?:number|null; cashout:number|null; net:number|null; settled_at:number|null;
}
export interface GameDetail extends Game { buy_in?:number; players:GamePlayer[]; rsvps:Rsvp[]; transfers:Transfer[]; event_name?:string; }
export interface LobbyData { game:Game; event:{id:string;name:string}; rsvps:Rsvp[]; players:GamePlayer[]; }
export interface LiveData { game:Game; event:{name:string}; players:GamePlayer[]; totalIn:number; totalOut:number; bank:number; }
export interface ResultsData { game:Game; event:{name:string}; players:GamePlayer[]; transfers:Transfer[]; }
export interface RoomPlayerMerge {
  from_user_id:string;to_user_id:string;from_name:string;to_name:string;
  created_at:number;created_by:string;
}
export interface LeaderboardEntry {
  user_id:string; display_name:string; games_played:number; games_won:number;
  total_net:number; biggest_win:number; biggest_loss:number; last_played:number|null;
  // Room-scoped, saved-game references from the same resolver used for totals.
  // Never rely on names or one representative ID when showing detailed results.
  source_game_players?:Array<{game_id:string;user_id:string}>;
  aliases?:string[];
  identity_review_required?:boolean;
}
export interface Transfer { from:string; from_name:string; to:string; to_name:string; amount:number;
  id?:string; status?:'owed'|'paid'|'not_received'|'payer_claimed'|'legacy'; paid_at?:number|null; last_reminded_at?:number|null; reminder_count?:number; }
export interface SettlementResult { settlement_id:string; game_id:string; results:any[]; transfers:Transfer[]; settled_at:number; results_token:string; cached?:boolean; }
export interface RoomLedgerData { games:Game[]; transfers:Array<Transfer & {game_id:string;from_user?:string;to_user?:string}>; }
export type RoomDashboardLayout='command'|'live';
export interface RoomDashboardLayoutRecord {event_id:string;layout:RoomDashboardLayout;updated_at:number|null;}

export function fmt(cents:number):string {
  const abs=Math.abs(cents), s=`$${(abs/100).toFixed(2).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')}`;
  return cents<0?`-${s}`:s;
}
export function fmtSign(cents:number):string {
  if(cents===0) return '$0';
  return cents>0?`+${fmt(cents)}`:fmt(cents);
}
export function fmtDate(ts:number):string {
  return new Date(ts*1000).toLocaleString('en-AU',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Australia/Brisbane'});
}
export function waLink(phone:string,msg:string):string {
  const clean = phone.replace(/\D/g,'');
  return `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
}

export interface RsvpReplyChoice {
  value:string;
  label:string;
  status:'yes'|'maybe'|'no';
}
export interface RsvpBoardData {
  game:{id:string;scheduled_at:number;location:string|null;seats:number;status:string};
  event:{id:string;name:string};
  options:string[];
  responses?:RsvpReplyChoice[];
  guests:{id:string;display_name:string;status:'yes'|'no'|'maybe';arrival_option:string;seat_number:number|null;updated_at:number}[];
  players:{display_name:string;seat_number:number}[];
  version:number;
}
export interface RsvpBoardReceipt {
  ok:boolean;id?:string;edit_token?:string;status:string;arrival_option:string;seat_number:number|null;
}


export interface ClubDatePoll {
  id:string;event_id:string;title:string;options:number[];
  status:'open'|'closed';closes_at:number;selected_index:number|null;
  created_at:number;counts:number[];my_vote:number|null;
}
export interface ClubWaitlist {
  game_id:string;open:boolean;seats:number;filled:number;available:number;
  waiting:number;my_status:'waiting'|'offered'|'claimed'|'expired'|'withdrawn'|null;
  my_offer_expires_at:number|null;
  queue?:Array<{user_id:string;display_name:string;status:string;created_at:number;expires_at:number|null}>;
  note:string;
}
export type ClubMemberRequestKind='buyin'|'cashout'|'tournament_rebuy'|'addon';
export interface ClubMemberRequest {
  id:string;game_id:string;user_id:string;member_name:string;kind:ClubMemberRequestKind;
  note:string|null;status:'pending'|'approved'|'declined'|'resolved';
  created_at:number;updated_at:number;
}
export interface ClubMemberRequests {
  requests:ClubMemberRequest[];can_manage:boolean;game_status:string;note:string;
}
export interface ClubLeaguePoints {first:number;second:number;third:number;other:number}
export interface ClubLeagueSeason {
  id:string;event_id:string;name:string;starts_at:number;ends_at:number;
  points_first:number;points_second:number;points_third:number;points_other:number;
}
export interface ClubSeasonStandings {
  season:ClubLeagueSeason;settled_games:number;basis:string;
  standings:Array<{user_id:string;display_name:string;points:number;games_played:number;
    first_places:number;podiums:number;identity_review_required:boolean}>;
}


export interface ClubExpenseShare {
  user_id:string;share_cents:number;status:'proposed'|'accepted'|'declined';
  responded_at:number|null;
}
export interface ClubSharedExpense {
  id:string;event_id:string;game_id:string|null;category:string;title:string;
  notes:string|null;amount_cents:number;paid_by_user_id:string;created_by:string;
  status:'proposed'|'cancelled';created_at:number;shares:ClubExpenseShare[];
}
export interface ClubExpenseList {
  expenses:ClubSharedExpense[];
  members:Array<{user_id:string;display_name:string}>;
  note:string;
}
export type ClubExportKind='games'|'player_results'|'transfers'|'rsvps'|'rsvps_live'|'members'|'expense_splits'|'payment_events';
export interface ClubExportPage {
  kind:ClubExportKind;rows:Array<Record<string,unknown>>;has_more:boolean;
  next_offset:number|null;exported_at:number;note:string;
}
export interface ClubTournamentLevel {
  level_num:number;small_blind:number;big_blind:number;ante:number;
  duration_secs:number;is_break:boolean;
}
export interface ClubTournamentConfig {
  format:'tournament'|'rebuy'|'freezeout';
  starting_chips:number;buy_in_amount:number;rebuy_allowed:boolean;
  rebuy_levels:number;addon_allowed:boolean;addon_chips:number;
  payout_structure:Array<{place:number;pct:number}>;levels:ClubTournamentLevel[];
}
export interface ClubTournamentPreset {
  id:string;event_id:string;name:string;config:ClubTournamentConfig;
  created_at:number;updated_at:number;
}
export interface ClubGameTournament {
  state:Record<string,unknown>|null;
  levels:Array<Record<string,unknown>>;
}
