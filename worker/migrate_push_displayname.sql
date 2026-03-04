-- Migration: add display_name to push_subscriptions
-- Run once: wrangler d1 execute PKR_DB --remote --file=migrate_push_displayname.sql
ALTER TABLE push_subscriptions ADD COLUMN display_name TEXT;
CREATE INDEX IF NOT EXISTS idx_push_name ON push_subscriptions(event_id, display_name);
