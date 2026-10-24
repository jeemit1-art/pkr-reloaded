ALTER TABLE games ADD COLUMN variance INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_game ON settlements(game_id);
CREATE TABLE IF NOT EXISTS paid_carryover (
  game_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, amount INTEGER NOT NULL, paid_at INTEGER
);
