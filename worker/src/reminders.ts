import { Env } from './types';
import { sendPushToPlayer } from './push';

const GRACE   = 6 * 3600;   // don't nag within 6h of settling
const MIN_GAP = 20 * 3600;  // at most one reminder per ~day

const money = (c: number) => '$' + (c % 100 === 0 ? (c / 100).toFixed(0) : (c / 100).toFixed(2));

export async function sendPaymentReminders(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(`
    SELECT t.id, t.amount, t.from_name, t.to_name, g.id AS game_id, g.event_id, g.results_token, e.name AS event_name
    FROM settlement_transfers t
    JOIN games g  ON g.id = t.game_id
    JOIN events e ON e.id = g.event_id
    WHERE g.status = 'settled'
      AND t.status IN ('owed','not_received')
      AND t.created_at <= ?
      AND (t.last_reminded_at IS NULL OR t.last_reminded_at <= ?)
  `).bind(now - GRACE, now - MIN_GAP).all<any>();

  for (const r of rows.results) {
    if (!r.from_name) continue;
    const accepted=await sendPushToPlayer(env, r.event_id, r.from_name, {
      title: `You still owe ${money(r.amount)} — ${r.event_name}`,
      body: `Once paid, tell the host or co-host so they can confirm receipt in PKR.`,
      data: { gameId: r.game_id, eventId: r.event_id, type: 'payment_reminder', results_token: r.results_token },
    });
    // Count only push service acceptance, not attempted or failed sends.
    // This does NOT mean the device displayed or the payer read the reminder.
    if(accepted>0){
      await env.DB.prepare('UPDATE settlement_transfers SET last_reminded_at=?, reminder_count=reminder_count+1 WHERE id=?')
        .bind(now, r.id).run();
    }
  }
}
