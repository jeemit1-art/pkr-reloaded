-- PKR staging-only schema, derived from API routes as of October 2026.
-- TEST DATA ONLY. Never run against production; this is NOT a production migration.
-- This schema is deliberately created on an empty, independent staging database.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  plan TEXT NOT NULL DEFAULT 'trial',
  trial_started_at INTEGER,
  plan_expires_at INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT
);
CREATE INDEX idx_users_google_sub ON users(google_sub);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  buy_in INTEGER NOT NULL DEFAULT 0,
  host_id TEXT NOT NULL REFERENCES users(id),
  master_password TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_events_host ON events(host_id);

CREATE TABLE event_members (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('host','cohost','member')),
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id,user_id)
);
CREATE INDEX idx_event_members_user ON event_members(user_id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT,
  display_name TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_push_event ON push_subscriptions(event_id);
CREATE INDEX idx_push_name ON push_subscriptions(event_id,display_name);

CREATE TABLE event_players (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT,
  display_name TEXT NOT NULL,
  whatsapp TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id,display_name)
);
CREATE INDEX idx_event_players_event ON event_players(event_id);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scheduled_at INTEGER NOT NULL,
  location TEXT,
  notes TEXT,
  seats INTEGER NOT NULL DEFAULT 9,
  game_password TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','lobby','active','settled','cancelled')),
  results_token TEXT UNIQUE,
  live_token TEXT UNIQUE,
  variance INTEGER,
  hand_tracking INTEGER NOT NULL DEFAULT 0,
  current_hand_no INTEGER NOT NULL DEFAULT 0,
  current_dealer_seat INTEGER,
  chip_value REAL NOT NULL DEFAULT 0,
  starting_chips INTEGER NOT NULL DEFAULT 0,
  live_cards_enabled INTEGER NOT NULL DEFAULT 0,
  seat_draw_result TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_games_event ON games(event_id);
CREATE INDEX idx_games_scheduled ON games(scheduled_at);

CREATE TABLE game_rsvps (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'yes' CHECK(status IN ('yes','no','maybe')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id,display_name)
);
CREATE INDEX idx_rsvps_game ON game_rsvps(game_id);

CREATE TABLE game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  whatsapp TEXT,
  seat_number INTEGER,
  buy_ins INTEGER NOT NULL DEFAULT 0,
  buy_in_total INTEGER NOT NULL DEFAULT 0,
  cashout INTEGER,
  net INTEGER,
  settled_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(game_id,user_id),
  UNIQUE(game_id,display_name)
);
CREATE INDEX idx_game_players_user ON game_players(user_id);

CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id)
);

CREATE TABLE settlement_transfers (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  from_name TEXT,
  to_name TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'owed',
  paid_at INTEGER,
  last_reminded_at INTEGER,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_transfers_game ON settlement_transfers(game_id);

CREATE TABLE paid_carryover (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX idx_carryover_game ON paid_carryover(game_id);

CREATE TABLE leaderboard (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  total_net INTEGER NOT NULL DEFAULT 0,
  biggest_win INTEGER NOT NULL DEFAULT 0,
  biggest_loss INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX idx_leaderboard_event ON leaderboard(event_id,total_net DESC);

CREATE TABLE hands (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_no INTEGER NOT NULL,
  dealer_seat INTEGER,
  sb_seat INTEGER,
  bb_seat INTEGER,
  straddle INTEGER NOT NULL DEFAULT 0,
  board TEXT NOT NULL DEFAULT '[]',
  pot_chips INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'full',
  voided INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id,hand_no)
);
CREATE INDEX idx_hands_game ON hands(game_id,hand_no DESC);

CREATE TABLE hand_actions (
  id TEXT PRIMARY KEY,
  hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT,
  display_name TEXT NOT NULL,
  street TEXT NOT NULL,
  action TEXT NOT NULL,
  chips INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_hand_actions_hand ON hand_actions(hand_id,created_at);
CREATE INDEX idx_hand_actions_game ON hand_actions(game_id);

CREATE TABLE hand_results (
  id TEXT PRIMARY KEY,
  hand_id TEXT NOT NULL UNIQUE REFERENCES hands(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  winner_user_id TEXT,
  winner_name TEXT NOT NULL,
  pot_chips INTEGER NOT NULL DEFAULT 0,
  hole_cards TEXT NOT NULL DEFAULT '{}',
  split_pot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_hand_results_game ON hand_results(game_id);

CREATE TABLE hand_analyses (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name TEXT,
  analysis_type TEXT NOT NULL,
  prompt_summary TEXT,
  analysis TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_hand_analyses_game ON hand_analyses(game_id);

CREATE TABLE tournament_state (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'setup',
  current_level INTEGER NOT NULL DEFAULT 1,
  starting_chips INTEGER NOT NULL DEFAULT 10000,
  buy_in_amount INTEGER NOT NULL DEFAULT 0,
  rebuy_allowed INTEGER NOT NULL DEFAULT 0,
  rebuy_levels INTEGER NOT NULL DEFAULT 4,
  addon_allowed INTEGER NOT NULL DEFAULT 0,
  addon_chips INTEGER NOT NULL DEFAULT 0,
  payout_structure TEXT NOT NULL DEFAULT '[]',
  total_chips_in_play INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  level_started_at INTEGER,
  paused_elapsed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tournament_levels (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  level_num INTEGER NOT NULL,
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  ante INTEGER NOT NULL DEFAULT 0,
  duration_secs INTEGER NOT NULL DEFAULT 900,
  is_break INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id,level_num)
);
CREATE INDEX idx_tournament_levels_game ON tournament_levels(game_id,level_num);

CREATE TABLE tournament_rebuys (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rebuy',
  chips INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_tournament_rebuys_game ON tournament_rebuys(game_id);

CREATE TABLE tournament_eliminations (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  finishing_position INTEGER NOT NULL,
  eliminated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id,player_name)
);
