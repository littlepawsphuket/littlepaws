CREATE TABLE IF NOT EXISTS stay_pass_policy_approvals(
 id TEXT PRIMARY KEY,policy_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_policy_versions(id),
 content_hash TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES app_users(id),created_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_approval_insert BEFORE INSERT ON stay_pass_policy_approvals BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_policy_versions p WHERE p.id=NEW.policy_id AND p.status='draft' AND p.content_hash=NEW.content_hash) THEN RAISE(ABORT,'stay_pass_policy_confirmation_required') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_approval_no_update BEFORE UPDATE ON stay_pass_policy_approvals BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_approval_no_delete BEFORE DELETE ON stay_pass_policy_approvals BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_approval_required BEFORE UPDATE OF status,approved_at,approved_by ON stay_pass_policy_versions WHEN NEW.status='approved' AND OLD.status='draft' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_policy_approvals a WHERE a.policy_id=OLD.id AND a.content_hash=OLD.content_hash AND a.actor_id=NEW.approved_by AND a.created_at=NEW.approved_at) THEN RAISE(ABORT,'stay_pass_policy_approval_required') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(23,CURRENT_TIMESTAMP);
