ALTER TABLE stays ADD COLUMN direct_checkin_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_direct_checkin_key ON stays(direct_checkin_key);
