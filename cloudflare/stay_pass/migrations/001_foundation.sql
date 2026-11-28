-- Additive only. Apply to an isolated development database first.
-- Requires existing customers/dogs/appointments/stays/transactions/app_users.
CREATE TABLE IF NOT EXISTS stay_pass_schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stay_pass_plans(
 id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), write_token TEXT UNIQUE,
 created_at TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES app_users(id)
);
CREATE TABLE IF NOT EXISTS stay_pass_plan_versions(
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES stay_pass_plans(id),
 version INTEGER NOT NULL CHECK(version>0), plan_revision INTEGER NOT NULL CHECK(plan_revision>0), config TEXT NOT NULL CHECK(json_valid(config)),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), created_at TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES app_users(id), request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 UNIQUE(plan_id,version), UNIQUE(id,plan_id)
);
CREATE TABLE IF NOT EXISTS stay_pass_price_versions(
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES stay_pass_plans(id),
 plan_version_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
 effective_at TEXT NOT NULL, prices TEXT NOT NULL CHECK(json_valid(prices)),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), copied_from TEXT REFERENCES stay_pass_price_versions(id),
 created_at TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES app_users(id),
 request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 FOREIGN KEY(plan_version_id,plan_id) REFERENCES stay_pass_plan_versions(id,plan_id),
 UNIQUE(plan_id,version), UNIQUE(plan_id,effective_at)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_price_effective ON stay_pass_price_versions(plan_id,effective_at DESC);
CREATE TABLE IF NOT EXISTS stay_pass_policy_versions(
 id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, content_th TEXT NOT NULL, content_en TEXT NOT NULL,
 content_hash TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'Policy draft', request_key TEXT UNIQUE, request_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved')),
 created_at TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES app_users(id),
 approved_at TEXT, approved_by INTEGER REFERENCES app_users(id),
 CHECK(status='draft' OR (length(content_th)>0 AND length(content_en)>0 AND approved_at IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS stay_passes(
 id TEXT PRIMARY KEY, pass_number TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id),
 plan_version_id TEXT NOT NULL REFERENCES stay_pass_plan_versions(id), price_version_id TEXT NOT NULL REFERENCES stay_pass_price_versions(id),
 policy_version_id TEXT NOT NULL REFERENCES stay_pass_policy_versions(id),
 size TEXT NOT NULL CHECK(size IN('small','medium','large')),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), purchase_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending_payment','active','fully_used','expired','cancelled','refund_pending','refunded')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), CHECK(expires_at>purchase_at)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_owner ON stay_passes(customer_id,status,expires_at);
CREATE TABLE IF NOT EXISTS stay_pass_pets(
 pass_id TEXT NOT NULL REFERENCES stay_passes(id), dog_id INTEGER NOT NULL REFERENCES dogs(id),
 photo_consent INTEGER NOT NULL DEFAULT 0 CHECK(photo_consent IN(0,1)),
 registered_at TEXT NOT NULL, PRIMARY KEY(pass_id,dog_id)
);
CREATE TABLE IF NOT EXISTS stay_pass_payment_links(
 id TEXT PRIMARY KEY, pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose IN('sale','refund','reversal')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), original_link_id TEXT REFERENCES stay_pass_payment_links(id),
 created_at TEXT NOT NULL, CHECK(purpose='sale' OR original_link_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS stay_pass_credit_lots(
 id TEXT PRIMARY KEY, pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 source_kind TEXT NOT NULL CHECK(source_kind IN('purchase','carry_forward','adjustment')),
 source_lot_id TEXT REFERENCES stay_pass_credit_lots(id),
 issued_units INTEGER NOT NULL CHECK(issued_units>0), origin_value_cents INTEGER NOT NULL CHECK(origin_value_cents>=0),
 remaining_units INTEGER NOT NULL DEFAULT 0 CHECK(remaining_units>=0 AND remaining_units<=issued_units),
 reserved_units INTEGER NOT NULL DEFAULT 0 CHECK(reserved_units>=0),
 refund_held_units INTEGER NOT NULL DEFAULT 0 CHECK(refund_held_units>=0),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(reserved_units+refund_held_units<=remaining_units), UNIQUE(id,pass_id)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_lot_order ON stay_pass_credit_lots(pass_id,expires_at,id);
CREATE TABLE IF NOT EXISTS stay_pass_operations(
 id TEXT PRIMARY KEY, pass_id TEXT NOT NULL REFERENCES stay_passes(id), actor_id INTEGER NOT NULL REFERENCES app_users(id),
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL, expected_revision INTEGER NOT NULL,
 kind TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason))>0), created_at TEXT NOT NULL,
 result TEXT CHECK(result IS NULL OR json_valid(result)), UNIQUE(actor_id,request_key)
);
CREATE TABLE IF NOT EXISTS stay_pass_credit_transactions(
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES stay_pass_operations(id),
 pass_id TEXT NOT NULL, lot_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('purchase','reservation_hold','reservation_release','stay_consumption','daycare_consumption','cancellation_deduction','no_show_deduction','credit_restoration','renewal_carry_forward','renewal_transfer_out','expiration','refund','manual_adjustment','reversal','refund_hold','refund_release')),
 delta_units INTEGER NOT NULL, delta_reserved INTEGER NOT NULL DEFAULT 0, delta_refund_held INTEGER NOT NULL DEFAULT 0,
 before_units INTEGER NOT NULL, after_units INTEGER NOT NULL CHECK(after_units>=0),
 before_reserved INTEGER NOT NULL, after_reserved INTEGER NOT NULL CHECK(after_reserved>=0),
 before_refund_held INTEGER NOT NULL, after_refund_held INTEGER NOT NULL CHECK(after_refund_held>=0),
 booking_id INTEGER REFERENCES appointments(id), stay_id INTEGER REFERENCES stays(id), dog_id INTEGER REFERENCES dogs(id),
 reversal_of TEXT UNIQUE REFERENCES stay_pass_credit_transactions(id), recorded_at TEXT NOT NULL,
 FOREIGN KEY(lot_id,pass_id) REFERENCES stay_pass_credit_lots(id,pass_id),
 UNIQUE(operation_id,lot_id),
 CHECK(after_units=before_units+delta_units), CHECK(after_reserved=before_reserved+delta_reserved),
 CHECK(after_refund_held=before_refund_held+delta_refund_held),
 CHECK(after_reserved+after_refund_held<=after_units),
 CHECK(delta_units!=0 OR delta_reserved!=0 OR delta_refund_held!=0),
 CHECK((kind='reversal' AND reversal_of IS NOT NULL) OR (kind!='reversal' AND reversal_of IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_credit_history ON stay_pass_credit_transactions(pass_id,recorded_at,id);
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_guard BEFORE INSERT ON stay_pass_credit_transactions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots l JOIN stay_pass_operations o ON o.id=NEW.operation_id
 WHERE l.id=NEW.lot_id AND l.pass_id=NEW.pass_id AND o.pass_id=NEW.pass_id
 AND l.remaining_units=NEW.before_units AND l.reserved_units=NEW.before_reserved AND l.refund_held_units=NEW.before_refund_held
 AND NEW.after_units<=l.issued_units) THEN RAISE(ABORT,'stay_pass_balance_conflict') END;
 SELECT CASE WHEN NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t
 WHERE t.id=NEW.reversal_of AND t.pass_id=NEW.pass_id AND t.lot_id=NEW.lot_id AND t.kind!='reversal'
 AND NEW.delta_units=-t.delta_units AND NEW.delta_reserved=-t.delta_reserved AND NEW.delta_refund_held=-t.delta_refund_held)
 THEN RAISE(ABORT,'stay_pass_invalid_reversal') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_project AFTER INSERT ON stay_pass_credit_transactions BEGIN
 UPDATE stay_pass_credit_lots SET remaining_units=NEW.after_units,reserved_units=NEW.after_reserved,refund_held_units=NEW.after_refund_held WHERE id=NEW.lot_id;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_no_update BEFORE UPDATE ON stay_pass_credit_transactions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_no_delete BEFORE DELETE ON stay_pass_credit_transactions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TABLE IF NOT EXISTS stay_pass_audit_logs(
 id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, action TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES app_users(id), recorded_at TEXT NOT NULL, reason TEXT NOT NULL,
 before_data TEXT CHECK(before_data IS NULL OR json_valid(before_data)), after_data TEXT NOT NULL CHECK(json_valid(after_data)),
 operation_id TEXT REFERENCES stay_pass_operations(id)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_audit_subject ON stay_pass_audit_logs(subject_type,subject_id,recorded_at);
CREATE TRIGGER IF NOT EXISTS stay_pass_audit_no_update BEFORE UPDATE ON stay_pass_audit_logs BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_audit_no_delete BEFORE DELETE ON stay_pass_audit_logs BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_plan_version_no_update BEFORE UPDATE ON stay_pass_plan_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_plan_version_no_delete BEFORE DELETE ON stay_pass_plan_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_price_version_no_update BEFORE UPDATE ON stay_pass_price_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_price_version_no_delete BEFORE DELETE ON stay_pass_price_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_no_update BEFORE UPDATE OF id,version,content_th,content_en,content_hash,created_at,actor_id ON stay_pass_policy_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_policy_no_delete BEFORE DELETE ON stay_pass_policy_versions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_payment_no_delete BEFORE DELETE ON stay_pass_payment_links BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_payment_no_update BEFORE UPDATE ON stay_pass_payment_links BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
-- Defense in depth: legacy ledger endpoints cannot edit/delete linked Pass cash.
CREATE TRIGGER IF NOT EXISTS stay_pass_cash_no_delete BEFORE DELETE ON transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_payment_links p WHERE p.transaction_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_managed_payment'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cash_no_update BEFORE UPDATE ON transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_payment_links p WHERE p.transaction_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_managed_payment'); END;
INSERT INTO stay_pass_schema_versions(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(version) DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_pass_lot_purchase ON stay_pass_credit_transactions(lot_id) WHERE kind='purchase';
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_projection_guard BEFORE UPDATE OF remaining_units,reserved_units,refund_held_units ON stay_pass_credit_lots
 WHEN OLD.remaining_units!=NEW.remaining_units OR OLD.reserved_units!=NEW.reserved_units OR OLD.refund_held_units!=NEW.refund_held_units
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t JOIN stay_pass_operations o ON o.id=t.operation_id
 JOIN stay_passes p ON p.id=o.pass_id WHERE t.lot_id=OLD.id AND o.result IS NULL AND p.revision=o.expected_revision
 AND t.before_units=OLD.remaining_units AND t.after_units=NEW.remaining_units
 AND t.before_reserved=OLD.reserved_units AND t.after_reserved=NEW.reserved_units
 AND t.before_refund_held=OLD.refund_held_units AND t.after_refund_held=NEW.refund_held_units)
 THEN RAISE(ABORT,'stay_pass_ledger_required') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_source_no_update BEFORE UPDATE OF pass_id,source_kind,source_lot_id,issued_units,origin_value_cents,created_at ON stay_pass_credit_lots
 BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_no_delete BEFORE DELETE ON stay_pass_credit_lots BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_snapshot_no_update BEFORE UPDATE OF snapshot,plan_version_id,price_version_id,policy_version_id,size,purchase_at ON stay_passes
 BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_payment_validate BEFORE INSERT ON stay_pass_payment_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions t JOIN stay_passes p ON p.id=NEW.pass_id WHERE t.id=NEW.transaction_id
 AND t.customer_id=p.customer_id AND CAST(ROUND(t.amount*100) AS INTEGER)=NEW.amount_cents
 AND ((NEW.purpose='sale' AND t.kind='income') OR (NEW.purpose='refund' AND t.kind='refund') OR NEW.purpose='reversal'))
 THEN RAISE(ABORT,'stay_pass_invalid_payment') END;
END;

CREATE TRIGGER IF NOT EXISTS stay_pass_approved_policy_immutable BEFORE UPDATE ON stay_pass_policy_versions WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
