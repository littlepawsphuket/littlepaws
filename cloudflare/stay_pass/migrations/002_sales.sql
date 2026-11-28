-- Development only until approved deployment. Requires foundation + existing payment columns.
CREATE TABLE IF NOT EXISTS stay_pass_sales(
 id TEXT PRIMARY KEY, pass_id TEXT NOT NULL UNIQUE REFERENCES stay_passes(id),
 actor_id INTEGER NOT NULL REFERENCES app_users(id), request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 quote_hash TEXT NOT NULL, recorded_at TEXT NOT NULL, reason TEXT NOT NULL,
 UNIQUE(actor_id,request_key)
);
CREATE TABLE IF NOT EXISTS stay_pass_policy_acceptances(
 id TEXT PRIMARY KEY, pass_id TEXT NOT NULL UNIQUE REFERENCES stay_passes(id),
 policy_version_id TEXT NOT NULL REFERENCES stay_pass_policy_versions(id),
 customer_id INTEGER NOT NULL REFERENCES customers(id), accepted_at TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN('in_person','line','document')),
 evidence TEXT NOT NULL CHECK(length(trim(evidence))>0), policy_hash TEXT NOT NULL,
 recorded_at TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES app_users(id)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_sale_no_update BEFORE UPDATE ON stay_pass_sales BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_sale_no_delete BEFORE DELETE ON stay_pass_sales BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_acceptance_no_update BEFORE UPDATE ON stay_pass_policy_acceptances BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_acceptance_no_delete BEFORE DELETE ON stay_pass_policy_acceptances BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_pass_cash_key ON transactions(payment_key) WHERE payment_type='stay_pass';
INSERT OR IGNORE INTO stay_pass_schema_versions(version,applied_at) VALUES(2,CURRENT_TIMESTAMP);
