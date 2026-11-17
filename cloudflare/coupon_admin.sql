ALTER TABLE coupons ADD COLUMN cloud_create_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_coupons_cloud_create_key ON coupons(cloud_create_key);
