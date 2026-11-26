-- PKR club engagement v1: additive, staging-first migration.
-- Requires independent D1 schema/backup/restore verification before production.
-- No existing games, financial ledger, membership or RSVP tables are modified.
CREATE TABLE IF NOT EXISTS room_date_polls (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
  options_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closes_at INTEGER NOT NULL,
  selected_index INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_room_date_polls_room ON room_date_polls(event_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_date_polls_open ON room_date_polls(event_id) WHERE status='open';
CREATE TABLE IF NOT EXISTS room_date_poll_votes (
  poll_id TEXT NOT NULL REFERENCES room_date_polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  option_index INTEGER NOT NULL CHECK(option_index BETWEEN 0 AND 4),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(poll_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_date_votes_option ON room_date_poll_votes(poll_id,option_index);

CREATE TABLE IF NOT EXISTS game_waitlist (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','offered','claimed','expired','withdrawn')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  offered_at INTEGER,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(game_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_waitlist_queue ON game_waitlist(game_id,status,created_at);
-- At most one open seat offer at a time. No automatic seat or cash allocation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_waitlist_active_offer
  ON game_waitlist(game_id) WHERE status='offered';

CREATE TABLE IF NOT EXISTS game_member_requests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('buyin','cashout','tournament_rebuy','addon')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','declined','resolved')),
  reviewed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_game_member_requests_game ON game_member_requests(game_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_member_requests_pending
  ON game_member_requests(game_id,user_id,kind) WHERE status='pending';

CREATE TABLE IF NOT EXISTS room_league_seasons (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 80),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  points_first INTEGER NOT NULL DEFAULT 10 CHECK(points_first BETWEEN 0 AND 100),
  points_second INTEGER NOT NULL DEFAULT 7 CHECK(points_second BETWEEN 0 AND 100),
  points_third INTEGER NOT NULL DEFAULT 5 CHECK(points_third BETWEEN 0 AND 100),
  points_other INTEGER NOT NULL DEFAULT 1 CHECK(points_other BETWEEN 0 AND 100),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS idx_room_league_seasons_room ON room_league_seasons(event_id,starts_at DESC);
