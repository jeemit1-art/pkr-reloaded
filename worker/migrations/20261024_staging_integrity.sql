-- Additive PKR integrity tables for isolated STAGING only.
-- DO NOT RUN IN PRODUCTION. This migration is NOT auto-applied by GitHub CI.
CREATE TABLE IF NOT EXISTS game_player_revisions (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(game_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_pkr_player_revisions
  ON game_player_revisions(game_id,revision);

CREATE TABLE IF NOT EXISTS game_financial_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  old_buy_ins INTEGER,
  new_buy_ins INTEGER,
  old_buy_in_total INTEGER,
  new_buy_in_total INTEGER,
  old_cashout INTEGER,
  new_cashout INTEGER,
  old_seat_number INTEGER,
  new_seat_number INTEGER,
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pkr_financial_audit
  ON game_financial_audit(game_id,user_id,revision);

CREATE TABLE IF NOT EXISTS hand_stack_baselines (
  hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  seat_number INTEGER NOT NULL CHECK(seat_number>0),
  opening_chips INTEGER NOT NULL CHECK(opening_chips>=0),
  verified_by TEXT NOT NULL,
  verified_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(hand_id,user_id),
  UNIQUE(hand_id,display_name),
  UNIQUE(hand_id,seat_number)
);
CREATE INDEX IF NOT EXISTS idx_pkr_hand_stack_baselines
  ON hand_stack_baselines(game_id,hand_id);

INSERT INTO game_player_revisions(game_id,user_id,revision,updated_at)
SELECT game_id,user_id,0,unixepoch() FROM game_players WHERE 1
ON CONFLICT(game_id,user_id) DO NOTHING;

-- Replace the earlier staging-only trigger definition if this migration was
-- already applied before insert/deletion audit support was introduced.
DROP TRIGGER IF EXISTS trg_pkr_player_revision_insert;
CREATE TRIGGER IF NOT EXISTS trg_pkr_player_revision_insert
AFTER INSERT ON game_players
BEGIN
  -- A newly registered player starts with revision 1. If an old player ID
  -- is reused, keep the prior revision and increment it to prevent ABA.
  INSERT INTO game_player_revisions(game_id,user_id,revision,updated_at)
  VALUES(NEW.game_id,NEW.user_id,1,unixepoch())
  ON CONFLICT(game_id,user_id) DO UPDATE SET
    revision=revision+1,updated_at=unixepoch();

  INSERT INTO game_financial_audit(
    game_id,user_id,revision,old_buy_ins,new_buy_ins,
    old_buy_in_total,new_buy_in_total,old_cashout,new_cashout,
    old_seat_number,new_seat_number,changed_at
  ) SELECT NEW.game_id,NEW.user_id,revision,
    NULL,NEW.buy_ins,NULL,NEW.buy_in_total,NULL,NEW.cashout,
    NULL,NEW.seat_number,unixepoch()
    FROM game_player_revisions
    WHERE game_id=NEW.game_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_pkr_player_revision_update
AFTER UPDATE OF buy_ins,buy_in_total,cashout,seat_number ON game_players
WHEN OLD.buy_ins IS NOT NEW.buy_ins
  OR OLD.buy_in_total IS NOT NEW.buy_in_total
  OR OLD.cashout IS NOT NEW.cashout
  OR OLD.seat_number IS NOT NEW.seat_number
BEGIN
  INSERT INTO game_player_revisions(game_id,user_id,revision,updated_at)
  VALUES(NEW.game_id,NEW.user_id,1,unixepoch())
  ON CONFLICT(game_id,user_id) DO UPDATE SET
    revision=revision+1,updated_at=unixepoch();
  INSERT INTO game_financial_audit(
    game_id,user_id,revision,old_buy_ins,new_buy_ins,
    old_buy_in_total,new_buy_in_total,old_cashout,new_cashout,
    old_seat_number,new_seat_number,changed_at
  ) SELECT NEW.game_id,NEW.user_id,revision,
    OLD.buy_ins,NEW.buy_ins,OLD.buy_in_total,NEW.buy_in_total,
    OLD.cashout,NEW.cashout,OLD.seat_number,NEW.seat_number,
    unixepoch() FROM game_player_revisions
  WHERE game_id=NEW.game_id AND user_id=NEW.user_id;
END;


-- Preserve a deletion as an auditable revision. The revision row intentionally
-- remains, so recreating the same user_id will never resurrect the old version.
CREATE TRIGGER IF NOT EXISTS trg_pkr_player_revision_delete
AFTER DELETE ON game_players
BEGIN
  INSERT INTO game_player_revisions(game_id,user_id,revision,updated_at)
  VALUES(OLD.game_id,OLD.user_id,1,unixepoch())
  ON CONFLICT(game_id,user_id) DO UPDATE SET
    revision=revision+1,updated_at=unixepoch();

  INSERT INTO game_financial_audit(
    game_id,user_id,revision,old_buy_ins,new_buy_ins,
    old_buy_in_total,new_buy_in_total,old_cashout,new_cashout,
    old_seat_number,new_seat_number,changed_at
  ) SELECT OLD.game_id,OLD.user_id,revision,
    OLD.buy_ins,NULL,OLD.buy_in_total,NULL,OLD.cashout,NULL,
    OLD.seat_number,NULL,unixepoch()
    FROM game_player_revisions
    WHERE game_id=OLD.game_id AND user_id=OLD.user_id;
END;
