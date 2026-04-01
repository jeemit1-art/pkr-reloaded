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
  return res.json();
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

export const api = {
  auth: {
    me:       () => req<User>('/auth/me'),
    logout:   () => req('/auth/logout',{method:'POST'}),
    loginUrl: () => `${API}/auth/google`,
    refresh:  () => req<{token:string}>('/auth/refresh',{method:'POST'}),
  },
  events: {
    list:           ()               => req<Event[]>('/events'),
    get:            (id:string)      => req<EventDetail>(`/events/${id}`),
    create:         (d:any)          => req<Event>('/events',{method:'POST',body:JSON.stringify(d)}),
    update:         (id:string,d:any)=> req(`/events/${id}`,{method:'PUT',body:JSON.stringify(d)}),
    end:            (id:string)      => req<{ok:boolean}>(`/events/${id}/end`,{method:'POST'}),
    reopen:         (id:string)      => req<{ok:boolean}>(`/events/${id}/reopen`,{method:'POST'}),
    invite:         (id:string,role?:string) => req<{token:string;url:string;role:string}>(`/events/${id}/invite`,{method:'POST',body:JSON.stringify({role:role||'cohost'})}),
    redeemInvite:   (token:string)   => req<{ok:boolean;event:Event;role:string}>(`/events/invite/${token}`),
    subscribe:      (eventId:string,sub:any,userId?:string,displayName?:string) =>
      pub(`/events/${eventId}/subscribe`,{method:'POST',body:JSON.stringify({...sub,userId,display_name:displayName})}),
    unsubscribe:    (eventId:string,endpoint:string) =>
      pub(`/events/${eventId}/unsubscribe`,{method:'POST',body:JSON.stringify({endpoint})}),
    leaderboard:    (id:string)      => req<LeaderboardEntry[]>(`/events/${id}/leaderboard`),
    history:        (id:string)      => req<Game[]>(`/events/${id}/history`),
    deleteGame:     (gameId:string)  => req<{ok:boolean}>(`/games/${gameId}`,{method:'DELETE'}),
    players:        (id:string)      => req<EventPlayer[]>(`/events/${id}/players`),
    verifyPassword: (id:string,password:string) =>
      req<{ok:boolean;required:boolean}>(`/events/${id}/verify-password`,{method:'POST',body:JSON.stringify({password})}),
    mergePlayers: (id:string, from_name:string, to_name:string) =>
      post(`/events/${id}/players/merge`, {from_name, to_name}),
  removeMember: (id:string, userId:string) => req(`/events/${id}/members/${userId}`,{method:'DELETE'}),
  },
  games: {
    list:     (eventId:string,status?:string) => req<Game[]>(`/events/${eventId}/games${status?`?status=${status}`:''}`),
    get:      (id:string)         => req<GameDetail>(`/games/${id}`),
    lobby:    (id:string)         => pub<LobbyData>(`/games/${id}/lobby`),
    live:     (token:string)      => pub<LiveData>(`/games/live/${token}`),
    results:  (token:string)      => pub<ResultsData>(`/games/results/${token}`),
    create:   (eventId:string,d:any) => req<Game>(`/events/${eventId}/games`,{method:'POST',body:JSON.stringify(d)}),
    update:   (id:string,d:any)   => req(`/games/${id}`,{method:'PUT',body:JSON.stringify(d)}),
    settle:   (id:string,d:any)   => req<SettlementResult>(`/games/${id}/settle`,{method:'POST',body:JSON.stringify(d)}),
    start:    (id:string,password?:string) => req(`/games/${id}/start`,{method:'POST',body:JSON.stringify({password:password||''})}),
    rsvp:     (id:string,d:any)   => pub<{ok:boolean;rsvps:Rsvp[]}>(`/games/${id}/rsvp`,{method:'POST',body:JSON.stringify(d)}),
    seat:     (id:string,d:any)   => req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/seat`,{method:'POST',body:JSON.stringify(d)}),
    removeSeat:(id:string,userId:string) => req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/seat/${userId}`,{method:'DELETE'}),
    buyin:    (id:string,userId:string)  => req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/buyin/${userId}`,{method:'POST'}),
    cashout:  (id:string,userId:string,cashout:number) =>
      req<{ok:boolean;players:GamePlayer[]}>(`/games/${id}/cashout/${userId}`,{method:'POST',body:JSON.stringify({cashout})}),
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
  id:string; name:string; description:string|null; buy_in:number; master_password:string|null;
  host_id:string; created_at:number; role?:string; member_count?:number; game_count?:number;
  status?: string;
}
export interface EventMember { id:string; name:string; avatar_url:string|null; email:string; role:string; joined_at:number; }
export interface EventDetail extends Event { members:EventMember[]; }
export interface EventPlayer { id:string; event_id:string; display_name:string; whatsapp:string|null; games_played:number; }
export interface Game {
  id:string; event_id:string; scheduled_at:number; location:string|null; notes:string|null;
  seats:number; game_password:string|null; status:string; live_token:string|null;
  results_token:string|null; created_at:number; player_count?:number;
}
export interface Rsvp { id:string; game_id:string; display_name:string; whatsapp:string|null; status:string; created_at:number; }
export interface GamePlayer {
  game_id:string; user_id:string; display_name:string; whatsapp:string|null;
  seat_number:number|null; buy_ins:number; cashout:number|null; net:number|null; settled_at:number|null;
}
export interface GameDetail extends Game { players:GamePlayer[]; rsvps:Rsvp[]; }
export interface LobbyData { game:Game; event:{id:string;name:string}; rsvps:Rsvp[]; players:GamePlayer[]; }
export interface LiveData { game:Game; event:{name:string}; players:GamePlayer[]; totalIn:number; totalOut:number; bank:number; }
export interface ResultsData { game:Game; event:{name:string}; players:GamePlayer[]; transfers:Transfer[]; }
export interface LeaderboardEntry { user_id:string; display_name:string; games_played:number; games_won:number; total_net:number; biggest_win:number; biggest_loss:number; last_played:number|null; }
export interface Transfer { from:string; from_name:string; to:string; to_name:string; amount:number; }
export interface SettlementResult { settlement_id:string; game_id:string; results:any[]; transfers:Transfer[]; settled_at:number; results_token:string; cached?:boolean; }

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
