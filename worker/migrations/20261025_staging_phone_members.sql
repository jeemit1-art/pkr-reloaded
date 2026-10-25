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
CREATE TABLE IF NOT EXISTS verified_phone_identities (
  phone_lookup TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  verified_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS group_phone_invites (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES group_phone_contacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','cohost')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER,
  verify_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_group_phone_invites_contact
  ON group_phone_invites(contact_id, expires_at DESC);
