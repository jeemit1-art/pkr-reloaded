-- ================================================
--  PKR RELOADED — Database Schema
--  Run: npm run db:migrate
-- ================================================

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  buy_in          INTEGER NOT NULL DEFAULT 0,
  host_id         TEXT NOT NULL REFERENCES users(id),
  master_password TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS event_members (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('host','cohost','member')),
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_members_user ON event_members(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id),
  display_name TEXT,                          -- for anonymous lobby subscribers matched by name
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth_key     TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_push_event ON push_subscriptions(event_id);
CREATE INDEX IF NOT EXISTS idx_push_name  ON push_subscriptions(event_id, display_name);

-- Known players per event (for quick-seat)
CREATE TABLE IF NOT EXISTS event_players (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  whatsapp     TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, display_name)
);
CREATE INDEX IF NOT EXISTS idx_event_players_event ON event_players(event_id);

CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scheduled_at    INTEGER NOT NULL,
  location        TEXT,
  notes           TEXT,
  seats           INTEGER NOT NULL DEFAULT 9,
  game_password   TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','lobby','active','settled','cancelled')),
  results_token   TEXT UNIQUE,
  live_token      TEXT UNIQUE,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_games_event     ON games(event_id);
CREATE INDEX IF NOT EXISTS idx_games_scheduled ON games(scheduled_at);

-- RSVPs
CREATE TABLE IF NOT EXISTS game_rsvps (
  id           TEXT PRIMARY KEY,
  game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  whatsapp     TEXT,
  status       TEXT NOT NULL DEFAULT 'yes' CHECK (status IN ('yes','no','maybe')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id, display_name)
);
CREATE INDEX IF NOT EXISTS idx_rsvps_game ON game_rsvps(game_id);

CREATE TABLE IF NOT EXISTS game_players (
  game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  whatsapp     TEXT,
  seat_number  INTEGER,
  buy_ins      INTEGER NOT NULL DEFAULT 1,
  cashout      INTEGER,
  net          INTEGER,
  settled_at   INTEGER,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);

CREATE TABLE IF NOT EXISTS settlements (
  id              TEXT PRIMARY KEY,
  game_id         TEXT NOT NULL REFERENCES games(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settlement_transfers (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES games(id),
  from_user  TEXT NOT NULL,
  to_user    TEXT NOT NULL,
  from_name  TEXT,
  to_name    TEXT,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_transfers_game ON settlement_transfers(game_id);

CREATE TABLE IF NOT EXISTS leaderboard (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won    INTEGER NOT NULL DEFAULT 0,
  total_net    INTEGER NOT NULL DEFAULT 0,
  biggest_win  INTEGER NOT NULL DEFAULT 0,
  biggest_loss INTEGER NOT NULL DEFAULT 0,
  last_played  INTEGER,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_event ON leaderboard(event_id, total_net DESC);
