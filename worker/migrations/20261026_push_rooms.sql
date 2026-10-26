-- Optional additive multi-room Web Push registration (v2).
-- Do not apply to production without a verified D1 backup/restore rehearsal.
-- Activate PKR_PUSH_ROOMS_V2=1 only AFTER applying this migration.
-- Legacy push_subscriptions and its unique endpoint constraint remain untouched.

CREATE TABLE IF NOT EXISTS push_room_subscriptions (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_room_subscriptions_user
  ON push_room_subscriptions (user_id, event_id);
