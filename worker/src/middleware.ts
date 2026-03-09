// worker/src/middleware.ts
// FULL REPLACEMENT — adds getPlanStatus helper used by event/game gates
import { Context, Next } from 'hono';
import { Env, User } from './types';
import { verifyJWT, getTokenFromRequest } from './jwt';

type AppContext = Context<{ Bindings: Env; Variables: { userId: string } }>;

export async function authMiddleware(c: AppContext, next: Next) {
  const token = getTokenFromRequest(c.req.raw);
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);
  c.set('userId', payload.sub);
  await next();
}

export async function optionalAuth(c: AppContext, next: Next) {
  const token = getTokenFromRequest(c.req.raw);
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (payload) c.set('userId', payload.sub);
  }
  await next();
}

export async function requireEventRole(
  c: AppContext,
  eventId: string,
  minRole: 'member'|'cohost'|'host'
): Promise<boolean> {
  const userId = c.get('userId');
  if (!userId) return false;
  const member = await c.env.DB.prepare(
    'SELECT role FROM event_members WHERE event_id=? AND user_id=?'
  ).bind(eventId, userId).first<{ role: string }>();
  if (!member) return false;
  const rank = { member:1, cohost:2, host:3 };
  return (rank[member.role as keyof typeof rank]||0) >= rank[minRole];
}

// ── Plan status helper — used by gates in events.ts and games.ts ──────────────
export interface PlanStatus {
  plan: string;
  is_active: boolean;    // trial active OR paid plan
  trial_active: boolean;
  max_groups: number | null;   // null = unlimited
  max_seats: number;
}

export async function getPlanStatus(db: D1Database, userId: string): Promise<PlanStatus> {
  const user = await db.prepare(
    'SELECT plan, trial_started_at, plan_expires_at FROM users WHERE id=?'
  ).bind(userId).first<{ plan: string; trial_started_at: number | null; plan_expires_at: number | null }>();

  if (!user) return { plan: 'trial', is_active: false, trial_active: false, max_groups: 1, max_seats: 9 };

  const now = Math.floor(Date.now() / 1000);
  const TRIAL_DAYS = 5;

  // Initialise trial if never set
  let trialStart = user.trial_started_at;
  if (!trialStart) {
    await db.prepare('UPDATE users SET trial_started_at=? WHERE id=?').bind(now, userId).run();
    trialStart = now;
  }

  const trialEnd = trialStart + TRIAL_DAYS * 86400;
  const trialActive = user.plan === 'trial' && now < trialEnd;

  let plan = user.plan;
  // Expire paid plan if period ended
  if ((plan === 'starter' || plan === 'pro') && user.plan_expires_at && user.plan_expires_at < now) {
    plan = 'trial';
    await db.prepare("UPDATE users SET plan='trial' WHERE id=?").bind(userId).run();
  }

  const isActive = plan === 'lifetime' || plan === 'starter' || plan === 'pro' || trialActive;
  const isPro = plan === 'pro' || plan === 'lifetime';

  return {
    plan,
    is_active: isActive,
    trial_active: trialActive,
    // Pro: unlimited groups; Trial/Starter while active: unlimited; expired trial: 1
    max_groups: isPro ? null : (isActive ? null : 1),
    max_seats: isPro ? 15 : 9,
  };
}

export function generateId(): string { return crypto.randomUUID(); }

export function corsHeaders(origin: string, frontendUrl?: string): Record<string,string> {
  const allowed = [
    frontendUrl || '',
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean);
  const ao = allowed.find(a => a === origin) ?? allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin':      ao,
    'Access-Control-Allow-Methods':     'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
