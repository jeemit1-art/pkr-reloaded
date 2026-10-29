-- Private PKR room player profiles (additive; no financial or membership records changed).
-- Apply on a staging D1 copy first. Export and verify production D1 before rollout.
-- Room names/avatars are presentation aliases only; no historic game results are renamed.
CREATE TABLE IF NOT EXISTS room_player_profiles (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  profile_key TEXT NOT NULL,
  screen_name TEXT,
  avatar_data TEXT,
  avatar_emoji TEXT,
  phone TEXT,
  preferred_contact TEXT NOT NULL DEFAULT 'none'
    CHECK(preferred_contact IN ('none','whatsapp','sms','email')),
  private_notes TEXT,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(event_id,profile_key)
);
CREATE INDEX IF NOT EXISTS idx_room_player_profiles_updated
  ON room_player_profiles(event_id,updated_at DESC);
