-- Private image history only: creating an image never updates credits or payments.
CREATE TABLE IF NOT EXISTS stay_pass_generated_images(
 id TEXT PRIMARY KEY,pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 actor_id INTEGER NOT NULL REFERENCES app_users(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('card','usage','renewal','guide')),
 language TEXT NOT NULL CHECK(language IN('th','en','bi')),template_version TEXT NOT NULL,
 policy_version TEXT NOT NULL,price_version TEXT NOT NULL,source_revision INTEGER NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),snapshot_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,page_count INTEGER NOT NULL CHECK(typeof(page_count)='integer' AND page_count BETWEEN 1 AND 128),
 UNIQUE(actor_id,request_key)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_image_history ON stay_pass_generated_images(pass_id,created_at,id);
CREATE TABLE IF NOT EXISTS stay_pass_generated_image_pages(
 image_id TEXT NOT NULL REFERENCES stay_pass_generated_images(id),page_index INTEGER NOT NULL CHECK(typeof(page_index)='integer' AND page_index>=0),
 html_key TEXT NOT NULL UNIQUE,html_hash TEXT NOT NULL,
 file_key TEXT NOT NULL UNIQUE,file_hash TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN('png','jpg')),width INTEGER NOT NULL CHECK(width=1080),
 height INTEGER NOT NULL CHECK(height BETWEEN 1350 AND 12000),byte_length INTEGER NOT NULL CHECK(byte_length>0),
 PRIMARY KEY(image_id,page_index)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_image_no_update BEFORE UPDATE ON stay_pass_generated_images BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_image_no_delete BEFORE DELETE ON stay_pass_generated_images BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_image_page_no_update BEFORE UPDATE ON stay_pass_generated_image_pages BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_image_page_no_delete BEFORE DELETE ON stay_pass_generated_image_pages BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_image_page_guard BEFORE INSERT ON stay_pass_generated_image_pages BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_generated_images WHERE id=NEW.image_id AND NEW.page_index<page_count)
  THEN RAISE(ABORT,'stay_pass_image_page_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions(version,applied_at) VALUES(9,CURRENT_TIMESTAMP);
