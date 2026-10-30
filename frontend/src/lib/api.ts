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
export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem('pkr_token');
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

  // Auto-refresh once on 401
  if (res.status === 401 && !isRetry && getToken()) {
    try {
      const rr = await fetch(`${API}/auth/refresh`, { method:'POST', credentials:'include',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${getToken()}` } });
      if (rr.ok) { const { token: newToken } = await rr.json(); saveToken(newToken); return req<T>(path, opts, true); }
    } catch {}
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Session expired');
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

export interface PrivateGroupContact {id:string;display_name:string;phone:string;user_id?:string|null;status:'joined'|'invited'|'awaiting_host_approval'|'approved_awaiting_member';created_at?:number}

export const api = {
  phoneInvites: {
    requestApproval:(token:string,display_name:string)=>pub<{claim:string;status:string}>(`/phone-invites/${encodeURIComponent(token)}/request-approval`,{method:'POST',body:JSON.stringify({display_name})}),
    completeApproval:(claim:string)=>pub<{ok:boolean;token:string;event_id:string;status?:string}>('/phone-invites/complete-approval',{method:'POST',body:JSON.stringify({claim})}),
    preview: (token:string)=>pub<{event_name:string;masked_phone:string;role:string;expires_at:number;approval_required:true;delivery:'manual_whatsapp'}>(`/phone-invites/${encodeURIComponent(token)}`),
  },
  auth: {
    me:       () => req<User>('/auth/me'),
    logout:   () => req('/auth/logout',{method:'POST'}),
    loginUrl: () => `${API}/auth/google`,
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
    joinRequests:(id:string)=>req<{requests:Array<{id:string;name:string;expected_member:string;phone:string;requested_at:number}>}>(`/events/${id}/join-requests`),
    decideJoin:(id:string,requestId:string,approve:boolean)=>req<{ok:boolean;approved:boolean;contact_id?:string}>(`/events/${id}/join-requests/${requestId}/decision`,{method:'POST',body:JSON.stringify({approve})}),
    phoneContacts:  (id:string) => req<{contacts:PrivateGroupContact[]}>(`/events/${id}/phone-contacts`),
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
    subscribe:      (eventId:string,sub:any,userId?:string,displayName?:string) =>
      req(`/events/${eventId}/subscribe`,{method:'POST',body:JSON.stringify({...sub,userId,display_name:displayName})}),
    unsubscribe:    (eventId:string,endpoint:string) =>
      req(`/events/${eventId}/unsubscribe`,{method:'POST',body:JSON.stringify({endpoint})}),
    leaderboard:    (id:string)      => req<LeaderboardEntry[]>(`/events/${id}/leaderboard`),
    history:        (id:string)      => req<Game[]>(`/events/${id}/history`),
    deleteGame:     (gameId:string)  => req<{ok:boolean}>(`/games/${gameId}`,{method:'DELETE'}),
    players:        (id:string)      => req<EventPlayer[]>(`/events/${id}/players`),
    profiles:       (id:string)      => req<{profiles:RoomPlayerProfile[]}>(`/events/${id}/profiles`),
    saveProfile:    (id:string,profile:RoomPlayerProfileInput) =>
      req<{ok:boolean;profile:RoomPlayerProfile}>(`/events/${id}/profiles`,{method:'PUT',body:JSON.stringify(profile)}),
    verifyPassword: (id:string,password:string) =>
      req<{ok:boolean;required:boolean}>(`/events/${id}/verify-password`,{method:'POST',body:JSON.stringify({password})}),
    mergePlayers: (id:string, from_name:string, to_name:string) =>
      req(`/events/${id}/players/merge`, {method:'POST', body:JSON.stringify({from_name, to_name})}),
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
    setRsvpTimes:(id:string,options:string[])=>
      req<{ok:boolean;options:string[]}>('/games/'+id+'/rsvp-arrivals',{method:'PUT',body:JSON.stringify({options})}),
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
  seat_number:number|null; buy_ins:number; cashout:number|null; net:number|null; settled_at:number|null;
}
export interface GameDetail extends Game { players:GamePlayer[]; rsvps:Rsvp[]; transfers:Transfer[]; event_name?:string; }
export interface LobbyData { game:Game; event:{id:string;name:string}; rsvps:Rsvp[]; players:GamePlayer[]; }
export interface LiveData { game:Game; event:{name:string}; players:GamePlayer[]; totalIn:number; totalOut:number; bank:number; }
export interface ResultsData { game:Game; event:{name:string}; players:GamePlayer[]; transfers:Transfer[]; }
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

export interface RsvpBoardData {
  game:{id:string;scheduled_at:number;location:string|null;seats:number;status:string};
  event:{id:string;name:string};
  options:string[];
  guests:{id:string;display_name:string;status:'yes'|'no'|'maybe';arrival_option:string;seat_number:number|null;updated_at:number}[];
  players:{display_name:string;seat_number:number}[];
  version:number;
}
export interface RsvpBoardReceipt {
  ok:boolean;id?:string;edit_token?:string;status:string;arrival_option:string;seat_number:number|null;
}
