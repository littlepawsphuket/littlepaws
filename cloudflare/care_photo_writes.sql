ALTER TABLE care_photos ADD COLUMN cloud_upload_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_care_photo_upload_key ON care_photos(cloud_upload_key);
