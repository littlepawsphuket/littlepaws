-- Additive development migration. No real customer credits or money are changed.
CREATE TABLE IF NOT EXISTS stay_pass_refunds(
 id TEXT PRIMARY KEY,pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 lot_id TEXT NOT NULL REFERENCES stay_pass_credit_lots(id),
 original_payment_link_id TEXT NOT NULL REFERENCES stay_pass_payment_links(id),
 request_operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),
 kind TEXT NOT NULL CHECK(kind IN('change_of_mind','death','serious_illness','force_majeure','shop_unavailable','shop_closure','legal')),
 units INTEGER NOT NULL CHECK(typeof(units)='integer' AND units>0),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>=0),
 requested_at TEXT NOT NULL,recorded_at TEXT NOT NULL,due_exclusive TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),evidence TEXT NOT NULL CHECK(length(trim(evidence))>0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 status TEXT NOT NULL CHECK(status IN('requested','approved','rejected','paid')),
 approved_at TEXT,approved_by INTEGER REFERENCES app_users(id),
 closed_at TEXT,closed_by INTEGER REFERENCES app_users(id),close_reason TEXT,
 payment_operation_id TEXT UNIQUE REFERENCES stay_pass_operations(id),
 payment_link_id TEXT UNIQUE REFERENCES stay_pass_payment_links(id),paid_at TEXT,payment_method TEXT,payment_evidence TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_pass_one_pending_refund ON stay_pass_refunds(pass_id) WHERE status IN('requested','approved');
CREATE INDEX IF NOT EXISTS ix_stay_pass_refund_due ON stay_pass_refunds(status,due_exclusive);
CREATE TRIGGER IF NOT EXISTS stay_pass_refund_request_guard BEFORE INSERT ON stay_pass_refunds BEGIN
 SELECT CASE WHEN NEW.status!='requested' OR NOT EXISTS(
  SELECT 1 FROM stay_pass_operations o JOIN stay_pass_credit_transactions t ON t.operation_id=o.id
  JOIN stay_pass_credit_lots l ON l.id=t.lot_id JOIN stay_pass_payment_links pay ON pay.id=NEW.original_payment_link_id
  WHERE o.id=NEW.request_operation_id AND o.pass_id=NEW.pass_id AND o.kind='refund_hold' AND o.result IS NULL
   AND t.pass_id=NEW.pass_id AND t.lot_id=NEW.lot_id AND t.kind='refund_hold'
   AND t.delta_units=0 AND t.delta_reserved=0 AND t.delta_refund_held=NEW.units
   AND l.source_kind='purchase' AND pay.pass_id=NEW.pass_id AND pay.purpose='sale'
   AND NEW.amount_cents<=pay.amount_cents-COALESCE((SELECT SUM(amount_cents) FROM stay_pass_payment_links f WHERE f.original_link_id=pay.id AND f.purpose='refund'),0)
 ) THEN RAISE(ABORT,'stay_pass_refund_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_refund_no_delete BEFORE DELETE ON stay_pass_refunds BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_refund_snapshot_lock BEFORE UPDATE OF
 id,pass_id,lot_id,original_payment_link_id,request_operation_id,kind,units,amount_cents,requested_at,recorded_at,due_exclusive,reason,evidence,snapshot
 ON stay_pass_refunds BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_refund_state_guard BEFORE UPDATE ON stay_pass_refunds BEGIN
 SELECT CASE WHEN NOT ((OLD.status='requested' AND NEW.status IN('approved','rejected')) OR (OLD.status='approved' AND NEW.status IN('paid','rejected')))
 THEN RAISE(ABORT,'stay_pass_refund_state') END;
 SELECT CASE WHEN NEW.status='approved' AND (NEW.approved_at IS NULL OR NEW.approved_by IS NULL)
 THEN RAISE(ABORT,'stay_pass_refund_approval_required') END;
 SELECT CASE WHEN NEW.status='paid' AND (NEW.paid_at IS NULL OR NEW.payment_evidence IS NULL OR NOT EXISTS(
  SELECT 1 FROM stay_pass_operations o JOIN stay_pass_credit_transactions t ON t.operation_id=o.id
  WHERE o.id=NEW.payment_operation_id AND o.pass_id=NEW.pass_id AND o.kind='refund' AND o.result IS NULL
   AND t.lot_id=NEW.lot_id AND t.delta_units=-NEW.units AND t.delta_refund_held=-NEW.units
 ) OR (NEW.amount_cents>0 AND NOT EXISTS(SELECT 1 FROM stay_pass_payment_links pay
  WHERE pay.id=NEW.payment_link_id AND pay.pass_id=NEW.pass_id AND pay.purpose='refund'
   AND pay.original_link_id=NEW.original_payment_link_id AND pay.amount_cents=NEW.amount_cents)))
 THEN RAISE(ABORT,'stay_pass_refund_payment_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(7,CURRENT_TIMESTAMP);
