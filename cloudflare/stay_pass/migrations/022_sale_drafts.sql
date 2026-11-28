CREATE TABLE IF NOT EXISTS stay_pass_sale_drafts(
 id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES stay_pass_plans(id),customer_id INTEGER NOT NULL REFERENCES customers(id),
 selection TEXT NOT NULL CHECK(json_valid(selection)),quoted_snapshot TEXT NOT NULL CHECK(json_valid(quoted_snapshot)),
 status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN('pending_payment','cancelled','paid')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES app_users(id),
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 paid_pass_id TEXT UNIQUE REFERENCES stay_passes(id),payment_hash TEXT,payment_result TEXT CHECK(payment_result IS NULL OR json_valid(payment_result)),
 CHECK((status='paid' AND paid_pass_id IS NOT NULL AND payment_hash IS NOT NULL AND payment_result IS NOT NULL) OR (status!='paid' AND paid_pass_id IS NULL AND payment_hash IS NULL AND payment_result IS NULL)),
 UNIQUE(actor_id,request_key)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_drafts ON stay_pass_sale_drafts(plan_id,status,created_at);
CREATE TABLE IF NOT EXISTS stay_pass_sale_draft_events(
 id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES stay_pass_sale_drafts(id),actor_id INTEGER NOT NULL REFERENCES app_users(id),
 kind TEXT NOT NULL CHECK(kind IN('created','cancelled','paid')),created_at TEXT NOT NULL,reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);
CREATE TRIGGER IF NOT EXISTS stay_pass_draft_no_delete BEFORE DELETE ON stay_pass_sale_drafts BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_draft_identity BEFORE UPDATE ON stay_pass_sale_drafts WHEN OLD.status!='pending_payment' OR NEW.id!=OLD.id OR NEW.plan_id!=OLD.plan_id OR NEW.customer_id!=OLD.customer_id OR NEW.selection!=OLD.selection OR NEW.quoted_snapshot!=OLD.quoted_snapshot OR NEW.created_at!=OLD.created_at OR NEW.actor_id!=OLD.actor_id OR NEW.request_key!=OLD.request_key OR NEW.request_hash!=OLD.request_hash OR NEW.reason!=OLD.reason OR NEW.revision!=OLD.revision+1 OR NEW.status NOT IN('cancelled','paid') BEGIN SELECT RAISE(ABORT,'stay_pass_draft_locked');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_draft_event_no_update BEFORE UPDATE ON stay_pass_sale_draft_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_draft_event_no_delete BEFORE DELETE ON stay_pass_sale_draft_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(22,CURRENT_TIMESTAMP);
