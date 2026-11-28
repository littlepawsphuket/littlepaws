CREATE TABLE IF NOT EXISTS stay_pass_sale_windows(
 plan_id TEXT NOT NULL REFERENCES stay_pass_plans(id),version INTEGER NOT NULL CHECK(version>0),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),starts_at TEXT,ends_at TEXT,created_at TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES app_users(id),reason TEXT NOT NULL CHECK(length(trim(reason))>0),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
 PRIMARY KEY(plan_id,version),CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_sale_window_no_update BEFORE UPDATE ON stay_pass_sale_windows BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_sale_window_no_delete BEFORE DELETE ON stay_pass_sale_windows BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(20,CURRENT_TIMESTAMP);
