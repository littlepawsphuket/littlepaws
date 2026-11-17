ALTER TABLE transactions ADD COLUMN cloud_ledger_revision TEXT;
ALTER TABLE transactions ADD COLUMN cloud_ledger_create_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_cloud_ledger_create_key ON transactions(cloud_ledger_create_key);
