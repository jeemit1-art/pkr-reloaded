-- PKR settlement audit. READ-ONLY: no UPDATE, INSERT, DELETE or DDL.
-- Run only against an explicitly selected D1 database after verifying the target.
-- All amounts below are stored in cents (AUD), not dollars.
-- A "legacy" status means unverified migration history, NOT an amount payable.
-- Never infer that a legacy transfer has been paid without source records.

SELECT COALESCE(status,'NULL') AS payment_status,
       COUNT(*) AS transfers,
       COALESCE(SUM(amount),0) AS total_amount_cents
FROM settlement_transfers
GROUP BY status
ORDER BY status;

SELECT e.name AS room_name,
       g.id AS game_id,
       g.scheduled_at AS scheduled_unix_seconds,
       COUNT(*) AS historic_transfers,
       COALESCE(SUM(t.amount),0) AS historic_amount_cents
FROM settlement_transfers AS t
JOIN games AS g ON g.id=t.game_id
JOIN events AS e ON e.id=g.event_id
WHERE t.status='legacy'
GROUP BY e.id,g.id
ORDER BY g.scheduled_at DESC
LIMIT 250;

SELECT COUNT(*) AS all_legacy_transfers,
       COALESCE(SUM(amount),0) AS legacy_amount_cents
FROM settlement_transfers
WHERE status='legacy';

-- Compare the last result against the alleged $75,235.00 (7,523,500 cents).
-- Do NOT alter payment statuses as part of this audit.
