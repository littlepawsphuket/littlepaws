ALTER TABLE dogs ADD COLUMN cloud_create_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_dogs_cloud_create_key ON dogs(customer_id,cloud_create_key);
