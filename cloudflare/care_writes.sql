ALTER TABLE care_events ADD COLUMN cloud_create_key TEXT;
ALTER TABLE care_events ADD COLUMN cloud_revision TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_care_cloud_create_key ON care_events(cloud_create_key);
