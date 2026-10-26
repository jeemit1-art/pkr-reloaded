import { describe, expect, it, vi } from 'vitest';

// This suite exercises the real Hono handlers with synthetic data. Authentication
// middleware is replaced with a trusted test host; no Cloudflare or Google secrets
// are present, and no real D1/KV operations are performed.
vi.mock('../middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware')>();
  return {
    ...original,
    authMiddleware: async (c: any, next: any) => {
      c.set('userId', 'fixture-host');
      await next();
    },
    requireEventRole: async () => true,
  };
});

vi.mock('../push', () => ({
  sendPushToEvent: vi.fn(async () => {}),
  sendPushToPlayer: vi.fn(async () => {}),
}));

import games from './games';
import events from './events';
import payments from './payments';

function fixture(status: string = 'active', cached?: { game_id: string; payload_json: string }) {
  const writes: string[] = [];
  let batchCalls = 0;
  const event = {
    id: 'evt', name: 'Safe testing only', buy_in: 2000, status: 'active',
    master_password: 'secret-pin-hash-must-not-leak',
  };
  const game = {
    id: 'game', event_id: event.id, status, scheduled_at: 1800000000,
    game_password: 'secret-game-password-must-not-leak',
    live_token: 'test-live-token', seats: 6,
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async first(): Promise<any> {
              if (sql.includes('FROM settlements WHERE idempotency_key=?')) return cached ?? null;
              if (sql.includes('FROM settlements WHERE game_id=?')) return null;
              if (sql.includes('FROM games WHERE id=?') || sql.includes('FROM games g WHERE g.id=?')) return game;
              if (sql.includes('FROM events WHERE id=?')) return event;
              if (sql.includes('FROM events e WHERE e.id=?')) return event;
              return null;
            },
            async all(): Promise<any> {
              if (sql.includes('FROM events e JOIN event_members em')) {
                return { results: [{...event,role:'host'}] };
              }
              if (sql.includes('FROM games WHERE event_id=?')) return { results: [game] };
              if (sql.includes('FROM games g WHERE g.event_id=?')) return { results: [game] };
              return { results: [] };
            },
            async run(): Promise<any> {
              writes.push(sql);
              if (sql.startsWith('UPDATE settlement_transfers') && _params[2] === 'missing') {
                return {meta:{changes:0}};
              }
              if (sql.includes("SET status='cancelled'")) game.status = 'cancelled';
              return {meta:{changes:1}};
            },
          };
        },
      };
    },
    async batch(_statements: unknown[]): Promise<any> {
      batchCalls++;
      return [];
    },
  };
  const env: any = {
    DB: db,
    KV: {get: async()=>null,put: async()=>{},delete: async()=>{}},
    FRONTEND_URL: 'https://isolated-preview.example.vercel.app',
    PKR_ENV: 'staging',
    JWT_SECRET: 'test-only',
  };
  return {env,game,event,writes,getBatchCalls:()=>batchCalls};
}

function json(method: string, body: unknown): RequestInit {
  return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
}

describe('API response confidentiality', () => {
  it('does not leak event password hashes in listing or detail responses', async () => {
    const f = fixture();
    const listed = await events.request('https://test.invalid/', {}, f.env);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).not.toContain('secret-pin-hash');
    const detail = await events.request('https://test.invalid/evt', {}, f.env);
    expect(detail.status).toBe(200);
    const body = await detail.json() as { name:string };
    expect(JSON.stringify(body)).not.toContain('secret-pin-hash');
    expect(body.name).toBe('Safe testing only');
  });

  it('does not leak game passwords through game listings, details or event history', async () => {
    const f = fixture('settled');
    const listed = await games.request('https://test.invalid/events/evt/games', {}, f.env);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).not.toContain('secret-game-password');
    const detail = await games.request('https://test.invalid/games/game', {}, f.env);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(await detail.json())).not.toContain('secret-game-password');
    const history = await events.request('https://test.invalid/evt/history', {}, f.env);
    expect(history.status).toBe(200);
    expect(JSON.stringify(await history.json())).not.toContain('secret-game-password');
  });
});

describe('game status and settlement protection', () => {
  it('prevents setting settled status through the generic update endpoint', async () => {
    const f = fixture();
    const response = await games.request('https://test.invalid/games/game',
      json('PUT',{status:'settled'}), f.env);
    expect(response.status).toBe(400);
    expect(f.game.status).toBe('active');
    expect(f.writes).toEqual([]);
  });

  it('supports the explicitly authorised game-cancellation endpoint', async () => {
    const f = fixture();
    const response = await games.request('https://test.invalid/games/game/cancel',
      json('POST',{}), f.env);
    expect(response.status).toBe(200);
    expect(f.game.status).toBe('cancelled');
    expect(f.writes).toHaveLength(1);
  });

  it('cannot cancel a settled game', async () => {
    const f = fixture('settled');
    const response = await games.request('https://test.invalid/games/game/cancel',
      json('POST',{}), f.env);
    expect(response.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it('rejects an unbalanced game before any financial database writes', async () => {
    const f = fixture();
    const response = await games.request('https://test.invalid/games/game/settle',
      json('POST',{
        idempotency_key:'test-game-unique-attempt',
        results:[
          {user_id:'alex',display_name:'Alex',buy_ins:1,buy_in_total:2000,cashout:1000},
          {user_id:'ben',display_name:'Ben',buy_ins:1,buy_in_total:2000,cashout:3001},
        ],
      }), f.env);
    expect(response.status).toBe(422);
    expect((await response.json() as { variance:number }).variance).toBe(1);
    expect(f.getBatchCalls()).toBe(0);
    expect(f.writes).toEqual([]);
  });

  it('does not disclose another game settlement via a reused idempotency key', async () => {
    const secret = 'other-game-private-results';
    const f = fixture('active',{game_id:'unrelated-game',payload_json:JSON.stringify({secret})});
    const response = await games.request('https://test.invalid/games/game/settle',
      json('POST',{
        idempotency_key:'reused-idempotency-key',
        results:[
          {user_id:'alex',display_name:'Alex',buy_ins:1,buy_in_total:2000,cashout:1000},
          {user_id:'ben',display_name:'Ben',buy_ins:1,buy_in_total:2000,cashout:3000},
        ],
      }), f.env);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain(secret);
    expect(f.getBatchCalls()).toBe(0);
  });
});


describe('payment acknowledgement integrity', () => {
  it('never marks transfers paid when the game has not been settled', async () => {
    const f = fixture('active');
    const response = await payments.request('https://test.invalid/games/game/transfers/t1/status',
      json('PUT',{status:'paid'}), f.env);
    expect(response.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it('allows a host to mark an existing settled-game transfer paid', async () => {
    const f = fixture('settled');
    const response = await payments.request('https://test.invalid/games/game/transfers/t1/status',
      json('PUT',{status:'paid'}), f.env);
    expect(response.status).toBe(200);
    expect(f.writes).toHaveLength(1);
  });

  it('returns not found rather than false success for a nonexistent transfer', async () => {
    const f = fixture('settled');
    const response = await payments.request('https://test.invalid/games/game/transfers/missing/status',
      json('PUT',{status:'paid'}), f.env);
    expect(response.status).toBe(404);
  });
});
