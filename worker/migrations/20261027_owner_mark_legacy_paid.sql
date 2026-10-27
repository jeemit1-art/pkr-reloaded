-- OWNER-AUTHORISED HISTORICAL PAYMENT RECLASSIFICATION - NOT AUTO-DEPLOYED.
-- Owner request: on 27 Oct 2026 mark ALL currently 'legacy' settlements paid.
-- Do not execute without a fresh independent D1 export, backup/restore check,
-- read-only transfer count and sum, and confirmed production database identity.
-- Apply 20261027_settlement_v2.sql first (audit table dependency).
-- All monetary amounts, payer/recipient IDs and actual game results remain intact.
-- paid_at is the ADMINISTRATIVE RECLASSIFICATION TIME, not verified bank receipt.
-- Trigger creates an audit row for each status transition, in the SAME SQLite
-- statement transaction. Re-running is idempotent as there are no more legacy rows.
-- This reclassification is made on express owner instruction, NOT payer/recipient
-- confirmation. The action name must not imply that recipients confirmed receipt.

CREATE TRIGGER IF NOT EXISTS trg_owner_legacy_paid_20261027_audit
AFTER UPDATE OF status ON settlement_transfers
WHEN OLD.status = 'legacy' AND NEW.status = 'paid'
BEGIN
  INSERT INTO settlement_confirmation_events
    (id,game_id,transfer_id,actor_id,action,previous_status,new_status,created_at)
  VALUES
    (lower(hex(randomblob(16))),NEW.game_id,NEW.id,
     'owner-authorised-2026-10-27',
     'owner_marked_legacy_paid_without_recipient_confirmation',
     OLD.status,NEW.status,unixepoch());
END;

-- ONLY payment status and administrative marked-paid timestamp are changed.
UPDATE settlement_transfers
SET status='paid', paid_at=COALESCE(paid_at,unixepoch()),
    last_reminded_at=NULL
WHERE status='legacy';

-- Read-only post-verification. Inspect result and archive privately.
SELECT COUNT(*) AS legacy_remaining,
       COALESCE(SUM(amount),0) AS legacy_remaining_cents
FROM settlement_transfers WHERE status='legacy';

SELECT COUNT(*) AS owner_marked_paid_count,
       COALESCE(SUM(t.amount),0) AS owner_marked_paid_cents
FROM settlement_confirmation_events a
JOIN settlement_transfers t ON t.id=a.transfer_id
WHERE a.action='owner_marked_legacy_paid_without_recipient_confirmation'
  AND a.actor_id='owner-authorised-2026-10-27';
