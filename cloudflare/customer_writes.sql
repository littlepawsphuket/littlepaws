ALTER TABLE customers ADD COLUMN cloud_create_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_cloud_create_key ON customers(cloud_create_key);
