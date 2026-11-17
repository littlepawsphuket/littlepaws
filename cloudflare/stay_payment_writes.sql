ALTER TABLE stay_payment_deletions ADD COLUMN cloud_request_key TEXT;
ALTER TABLE stay_payment_deletions ADD COLUMN cloud_transaction_id INTEGER;
ALTER TABLE stay_payment_deletions ADD COLUMN cloud_deleted_by INTEGER REFERENCES app_users(id);
ALTER TABLE stay_payment_deletions ADD COLUMN cloud_attempt TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_cloud_stay_payment_removal
  ON stay_payment_deletions(stay_id,cloud_request_key);
