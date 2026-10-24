import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole } from '../middleware';

const payments = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Public result links are read-only. Only the host or co-host may confirm payments.
// A secure payer-confirmation workflow requires verified player identity.
// Host / co-host sets status (received, not received, back to owed)
payments.put('/games/:id/transfers/:tid/status', authMiddleware, async (c) => {
  const { id: gameId, tid } = c.req.param();
  const { status } = await c.req.json<{ status: string }>();
  if (!['owed', 'paid', 'not_received'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?')
    .bind(gameId).first<{ event_id: string; status: string }>();
  if (!game) return c.json({ error: 'Game not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'cohost')) {
    return c.json({ error: 'Only host or co-host can change payment status' }, 403);
  }
  if (game.status !== 'settled') {
    return c.json({ error: 'Payment status can only be changed on a settled game' }, 409);
  }
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    'UPDATE settlement_transfers SET status=?, paid_at=?, last_reminded_at=NULL WHERE id=? AND game_id=?'
  ).bind(status, status === 'paid' ? now : null, tid, gameId).run();
  if (result.meta.changes === 0) {
    return c.json({ error: 'Settlement transfer not found in this game' }, 404);
  }
  return c.json({ ok: true, status });
});

export default payments;
