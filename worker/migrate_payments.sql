ALTER TABLE settlement_transfers ADD COLUMN status TEXT NOT NULL DEFAULT 'owed';
ALTER TABLE settlement_transfers ADD COLUMN paid_at INTEGER;
ALTER TABLE settlement_transfers ADD COLUMN last_reminded_at INTEGER;
ALTER TABLE settlement_transfers ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;
UPDATE settlement_transfers SET status='legacy';
