-- PKR club extras v1: optional food/venue cost proposals only.
-- Additive, staging-first. No poker settlement, game or member records change.
-- Apply only after tested D1 backup + restore rehearsal and release gate review.
CREATE TABLE IF NOT EXISTS room_shared_expenses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK(category IN ('food','venue','supplies','other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
  notes TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 5000000),
  paid_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','cancelled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_room_expenses_event ON room_shared_expenses(event_id,created_at DESC);
CREATE TABLE IF NOT EXISTS room_shared_expense_splits (
  expense_id TEXT NOT NULL REFERENCES room_shared_expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK(share_cents>=0),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed','accepted','declined')),
  responded_at INTEGER,
  PRIMARY KEY(expense_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_expense_splits_member
  ON room_shared_expense_splits(user_id,expense_id);
-- No actual payments, balances, chips or transfers are recorded by these tables.

-- Host-owned tournament setup snapshots. Config is validated on write and
-- revalidated by the existing guarded /games/:id/tournament/setup endpoint.
CREATE TABLE IF NOT EXISTS room_tournament_presets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 80),
  config_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id,name COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_room_tournament_presets_room
  ON room_tournament_presets(event_id,updated_at DESC);

-- One durable, unrepeatable promotional game claim per host. This table never
-- records a transfer, subscription, buy-in or settlement amount.
CREATE TABLE IF NOT EXISTS host_free_first_games (
  host_id TEXT PRIMARY KEY REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  game_id TEXT NOT NULL UNIQUE REFERENCES games(id),
  claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_host_free_games_game
  ON host_free_first_games(game_id);
