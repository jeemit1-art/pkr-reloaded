export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  FRONTEND_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_EMAIL: string;
}

export interface User {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: number;
}

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

export interface SettleRequest {
  idempotency_key: string;
  results: Array<{
    user_id: string;
    display_name: string;
    whatsapp?: string;
    buy_ins: number;
    cashout: number;
  }>;
}

export interface Transfer {
  from: string;
  from_name: string;
  to: string;
  to_name: string;
  amount: number;
}

export interface GamePlayer {
  game_id: string;
  user_id: string;
  display_name: string;
  whatsapp: string | null;
  seat_number: number | null;
  buy_ins: number;
  cashout: number | null;
  net: number | null;
  settled_at: number | null;
}

export interface GameRsvp {
  id: string;
  game_id: string;
  display_name: string;
  whatsapp: string | null;
  status: 'yes' | 'no' | 'maybe';
  created_at: number;
}

export interface EventPlayer {
  id: string;
  event_id: string;
  display_name: string;
  whatsapp: string | null;
  games_played: number;
}
