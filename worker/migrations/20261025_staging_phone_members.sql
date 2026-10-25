-- STAGING ONLY: mobile-first private group contacts and phone-verified invites.
-- Additive; no modifications to financial, game, or existing user records.
-- Requires PKR_PHONE_MEMBERS_V1=1 and configured secrets after independent backup.
CREATE TABLE IF NOT EXISTS group_phone_contacts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone_lookup TEXT NOT NULL,
  phone_cipher TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(event_id, phone_lookup)
);
CREATE INDEX IF NOT EXISTS idx_group_phone_contacts_event
  ON group_phone_contacts(event_id, display_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_phone_contact_pair ON group_phone_contacts(event_id,id);
CREATE TABLE IF NOT EXISTS verified_phone_identities (
  phone_lookup TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  verified_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS group_phone_invites (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','cohost')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER,
  verify_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY(event_id,contact_id) REFERENCES group_phone_contacts(event_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_phone_invites_contact
  ON group_phone_invites(contact_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS phone_verification_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL DEFAULT (unixepoch()),
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_phone_contacts_display_name
  ON group_phone_contacts(event_id,display_name COLLATE NOCASE);

-- A verified mobile member owns one RSVP per game across devices. The phone
-- itself is never stored in the RSVP table or revealed to other members.
CREATE TABLE IF NOT EXISTS game_rsvp_member_links (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  rsvp_id TEXT NOT NULL UNIQUE REFERENCES game_rsvp_guests(id) ON DELETE CASCADE,
  PRIMARY KEY(game_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS trg_phone_rsvp_link_valid
BEFORE INSERT ON game_rsvp_member_links
WHEN NOT EXISTS(
  SELECT 1 FROM game_rsvp_guests g
  JOIN games gg ON gg.id=g.game_id
  JOIN event_members em ON em.event_id=gg.event_id AND em.user_id=NEW.user_id
  WHERE g.id=NEW.rsvp_id AND g.game_id=NEW.game_id
)
BEGIN SELECT RAISE(ABORT,'Phone RSVP must belong to a member of the same group and game'); END;
