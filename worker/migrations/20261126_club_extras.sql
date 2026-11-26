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
