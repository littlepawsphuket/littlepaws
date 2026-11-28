CREATE TABLE IF NOT EXISTS stay_pass_image_template_versions(
 version INTEGER PRIMARY KEY CHECK(version>0),name TEXT NOT NULL,config TEXT NOT NULL CHECK(json_valid(config)),
 created_at TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES app_users(id),reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_image_template_no_update BEFORE UPDATE ON stay_pass_image_template_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_image_template_no_delete BEFORE DELETE ON stay_pass_image_template_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(18,CURRENT_TIMESTAMP);
