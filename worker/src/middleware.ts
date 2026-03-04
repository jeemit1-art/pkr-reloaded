import { Context, Next } from 'hono';
import { Env } from './types';
import { verifyJWT, getTokenFromRequest } from './jwt';

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getTokenFromRequest(c.req.raw);
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);
  c.set('userId', payload.sub);
  await next();
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getTokenFromRequest(c.req.raw);
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (payload) c.set('userId', payload.sub);
  }
  await next();
}

export async function requireEventRole(
  c: Context<{ Bindings: Env }>,
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

export function generateId(): string { return crypto.randomUUID(); }

export function corsHeaders(origin: string, frontendUrl?: string): Record<string,string> {
  const allowed = [
    frontendUrl || '',
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean);
  // Allow the requesting origin if it's in our list, otherwise use the primary frontend URL
  const ao = allowed.find(a => a === origin) ?? allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin':      ao,
    'Access-Control-Allow-Methods':     'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
