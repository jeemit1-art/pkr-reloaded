-- PKR Settlement V2 - additive migration, no historical settlement modifications.
-- APPLY ONLY AFTER: export + integrity-check + restore rehearsal of production D1.
-- Feature flag PKR_SETTLEMENT_V2=1 must stay off until migration is verified.
-- Existing settlement_transfers, payouts, results, statuses and game_players are unchanged.

CREATE TABLE IF NOT EXISTS settlement_notification_settings (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reminders_enabled IN (0,1)),
  last_broadcast_at INTEGER,
  started_at INTEGER,
  updated_by TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settlement_confirmation_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  transfer_id TEXT REFERENCES settlement_transfers(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_settlement_confirmation_events_game
  ON settlement_confirmation_events(game_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_confirmation_events_transfer
  ON settlement_confirmation_events(transfer_id,created_at DESC);
