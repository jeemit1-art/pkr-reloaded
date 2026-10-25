-- PKR RSVP board v2: isolated staging-first additive migration.
-- Do not apply to production without independent schema/backup/rollback review.
-- Options are host-managed and guests are separate from historical RSVP records.
CREATE TABLE IF NOT EXISTS game_rsvp_arrivals (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  options_json TEXT NOT NULL DEFAULT '["19:00","20:00","21:00"]',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS game_rsvp_guests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('yes','no')),
  arrival_option TEXT NOT NULL,
  seat_number INTEGER CHECK(seat_number BETWEEN 1 AND 15),
  edit_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(game_id, display_name COLLATE NOCASE),
  CHECK ((status = 'no' AND seat_number IS NULL AND arrival_option = 'not-coming')
       OR (status = 'yes' AND arrival_option != 'not-coming'))
);
-- Only one guest can reserve a seat, even under concurrent submissions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rsvp_guests_seat
  ON game_rsvp_guests(game_id,seat_number) WHERE seat_number IS NOT NULL AND status='yes';
CREATE INDEX IF NOT EXISTS idx_game_rsvp_guests_game
  ON game_rsvp_guests(game_id,updated_at DESC);

-- A host seat assignment and a guest RSVP reservation live in separate tables.
-- Database triggers close the race between their independent API checks.
CREATE TRIGGER IF NOT EXISTS trg_rsvp_reserve_vacant_insert
BEFORE INSERT ON game_rsvp_guests
WHEN NEW.status='yes' AND NEW.seat_number IS NOT NULL
  AND EXISTS(SELECT 1 FROM game_players
             WHERE game_id=NEW.game_id AND seat_number=NEW.seat_number)
BEGIN
  SELECT RAISE(ABORT,'RSVP seat is already assigned');
END;
CREATE TRIGGER IF NOT EXISTS trg_rsvp_reserve_vacant_update
BEFORE UPDATE OF seat_number,status ON game_rsvp_guests
WHEN NEW.status='yes' AND NEW.seat_number IS NOT NULL
  AND EXISTS(SELECT 1 FROM game_players
             WHERE game_id=NEW.game_id AND seat_number=NEW.seat_number)
BEGIN
  SELECT RAISE(ABORT,'RSVP seat is already assigned');
END;
CREATE TRIGGER IF NOT EXISTS trg_rsvp_host_seat_insert
BEFORE INSERT ON game_players
WHEN NEW.seat_number IS NOT NULL
 AND EXISTS(SELECT 1 FROM game_rsvp_guests
            WHERE game_id=NEW.game_id AND seat_number=NEW.seat_number
              AND status='yes' AND display_name COLLATE NOCASE <> NEW.display_name COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT,'Seat is reserved by another RSVP');
END;
CREATE TRIGGER IF NOT EXISTS trg_rsvp_host_seat_update
BEFORE UPDATE OF seat_number,display_name ON game_players
WHEN NEW.seat_number IS NOT NULL
 AND EXISTS(SELECT 1 FROM game_rsvp_guests
            WHERE game_id=NEW.game_id AND seat_number=NEW.seat_number
              AND status='yes' AND display_name COLLATE NOCASE <> NEW.display_name COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT,'Seat is reserved by another RSVP');
END;
