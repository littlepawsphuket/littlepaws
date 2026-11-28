-- Additive development migration: closed-stay cash follow-up and audited correction.
CREATE TABLE IF NOT EXISTS stay_pass_stay_cash_records(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),stay_id INTEGER NOT NULL REFERENCES stays(id),
 transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),direction TEXT NOT NULL CHECK(direction IN('receive','refund')),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 charge_cents INTEGER NOT NULL CHECK(typeof(charge_cents)='integer' AND charge_cents>=0),
 before_net_cents INTEGER NOT NULL CHECK(typeof(before_net_cents)='integer' AND before_net_cents>=0),
 after_net_cents INTEGER NOT NULL CHECK(typeof(after_net_cents)='integer' AND after_net_cents>=0),
 reversal_of TEXT UNIQUE REFERENCES stay_pass_stay_cash_records(id),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,
 CHECK(after_net_cents=before_net_cents+CASE direction WHEN 'receive' THEN amount_cents ELSE -amount_cents END),
 CHECK(reversal_of IS NOT NULL OR (direction='receive' AND after_net_cents<=charge_cents) OR (direction='refund' AND after_net_cents>=charge_cents))
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_stay_cash ON stay_pass_stay_cash_records(stay_id,created_at,id);
CREATE TABLE IF NOT EXISTS stay_pass_stay_cash_sources(
 record_id TEXT NOT NULL REFERENCES stay_pass_stay_cash_records(id),transaction_id INTEGER NOT NULL REFERENCES transactions(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),PRIMARY KEY(record_id,transaction_id)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_insert_guard BEFORE INSERT ON stay_pass_stay_cash_records BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkout_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_operations co ON co.id=c.operation_id JOIN stays s ON s.id=c.stay_id JOIN transactions t ON t.id=NEW.transaction_id
 WHERE o.id=NEW.id AND o.kind='stay_cash_followup' AND o.result IS NULL AND o.pass_id=co.pass_id AND co.result IS NOT NULL AND s.status='completed' AND s.cancelled_at IS NULL AND ROUND(s.agreed_total*100)=NEW.charge_cents AND c.total_cents=NEW.charge_cents
 AND t.customer_id=s.customer_id AND t.stay_id=s.id AND t.kind=CASE NEW.direction WHEN 'receive' THEN 'income' ELSE 'refund' END AND ROUND(t.amount*100)=NEW.amount_cents AND t.payment_key=o.request_key AND t.payment_type=CASE NEW.direction WHEN 'receive' THEN 'additional' ELSE '' END AND t.deposit_appointment_id IS NULL
 AND NEW.before_net_cents=COALESCE((SELECT SUM(CASE kind WHEN 'income' THEN ROUND(amount*100) WHEN 'refund' THEN -ROUND(amount*100) ELSE 0 END) FROM transactions WHERE stay_id=s.id AND id!=t.id),0)) THEN RAISE(ABORT,'stay_pass_stay_cash_mismatch') END;
 SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stay_pass_stay_cash_records r JOIN stay_pass_operations o ON o.id=r.id WHERE r.id=NEW.reversal_of AND r.stay_id=NEW.stay_id AND r.reversal_of IS NULL AND r.direction!=NEW.direction AND r.amount_cents=NEW.amount_cents AND o.result IS NOT NULL AND r.transaction_id=(SELECT MAX(transaction_id) FROM stay_pass_stay_cash_records WHERE stay_id=NEW.stay_id)) THEN RAISE(ABORT,'stay_pass_cash_reversal_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_source_guard BEFORE INSERT ON stay_pass_stay_cash_sources BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_stay_cash_records r JOIN stay_pass_operations o ON o.id=r.id JOIN stays s ON s.id=r.stay_id JOIN transactions t ON t.id=NEW.transaction_id WHERE r.id=NEW.record_id AND r.direction='refund' AND o.result IS NULL AND t.stay_id=s.id AND t.customer_id=s.customer_id AND t.kind='income' AND t.payment_type!=''
 AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM stay_pass_stay_cash_sources WHERE transaction_id=t.id),0)+COALESCE((SELECT SUM(amount_cents) FROM stay_pass_booking_cash_refund_sources WHERE transaction_id=t.id),0)<=ROUND(t.amount*100)) THEN RAISE(ABORT,'stay_pass_stay_cash_source_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_no_update BEFORE UPDATE ON stay_pass_stay_cash_records BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_no_delete BEFORE DELETE ON stay_pass_stay_cash_records BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_source_no_update BEFORE UPDATE ON stay_pass_stay_cash_sources BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_source_no_delete BEFORE DELETE ON stay_pass_stay_cash_sources BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_tx_no_update BEFORE UPDATE ON transactions WHEN EXISTS(SELECT 1 FROM stay_pass_stay_cash_records WHERE stay_id=OLD.stay_id OR transaction_id=OLD.id) BEGIN SELECT RAISE(ABORT,'stay_pass_cash_receipt_locked');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_tx_no_delete BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM stay_pass_stay_cash_records WHERE stay_id=OLD.stay_id OR transaction_id=OLD.id) BEGIN SELECT RAISE(ABORT,'stay_pass_cash_receipt_locked');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cash_finalize BEFORE UPDATE OF result ON stay_pass_operations WHEN OLD.result IS NULL AND NEW.result IS NOT NULL AND NEW.kind='stay_cash_followup' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_stay_cash_records r WHERE r.id=NEW.id AND (r.direction='receive' AND NOT EXISTS(SELECT 1 FROM stay_pass_stay_cash_sources WHERE record_id=r.id) OR r.direction='refund' AND r.amount_cents=(SELECT SUM(amount_cents) FROM stay_pass_stay_cash_sources WHERE record_id=r.id))) OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions WHERE operation_id=NEW.id) THEN RAISE(ABORT,'stay_pass_stay_cash_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(16,CURRENT_TIMESTAMP);
