-- Additive, development-only cash follow-up for fully cancelled Pass bookings.
-- No quota or historical receipt is altered by this migration or its writer.
CREATE TABLE IF NOT EXISTS stay_pass_booking_cash_records(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),booking_id INTEGER NOT NULL REFERENCES appointments(id),
 cancellation_id TEXT NOT NULL REFERENCES stay_pass_booking_cancellations(id),transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
 direction TEXT NOT NULL CHECK(direction IN('receive','refund')),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 charge_cents INTEGER NOT NULL CHECK(typeof(charge_cents)='integer' AND charge_cents>=0),
 before_net_cents INTEGER NOT NULL CHECK(typeof(before_net_cents)='integer' AND before_net_cents>=0),
 after_net_cents INTEGER NOT NULL CHECK(typeof(after_net_cents)='integer' AND after_net_cents>=0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,
 CHECK(after_net_cents=before_net_cents+CASE direction WHEN 'receive' THEN amount_cents ELSE -amount_cents END),
 CHECK((direction='receive' AND after_net_cents<=charge_cents) OR (direction='refund' AND after_net_cents>=charge_cents))
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_booking_cash ON stay_pass_booking_cash_records(booking_id,created_at,id);
CREATE TABLE IF NOT EXISTS stay_pass_booking_cash_refund_sources(
 record_id TEXT NOT NULL REFERENCES stay_pass_booking_cash_records(id),transaction_id INTEGER NOT NULL REFERENCES transactions(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),PRIMARY KEY(record_id,transaction_id)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_insert_guard BEFORE INSERT ON stay_pass_booking_cash_records BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_cancellations c ON c.id=NEW.cancellation_id JOIN appointments a ON a.id=c.booking_id JOIN transactions t ON t.id=NEW.transaction_id
 WHERE o.id=NEW.id AND o.kind='booking_cash_followup' AND o.result IS NULL AND o.pass_id=c.pass_id AND c.booking_id=NEW.booking_id AND c.remaining_dogs=0 AND a.status='cancelled' AND a.stay_id IS NULL AND ROUND(a.agreed_total*100)=NEW.charge_cents AND c.cash_after_cents=NEW.charge_cents
 AND t.customer_id=a.customer_id AND t.kind=CASE NEW.direction WHEN 'receive' THEN 'income' ELSE 'refund' END AND ROUND(t.amount*100)=NEW.amount_cents AND t.payment_key=o.request_key AND t.stay_id IS NULL AND t.deposit_appointment_id IS NULL AND t.payment_type='')
 THEN RAISE(ABORT,'stay_pass_booking_cash_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_source_guard BEFORE INSERT ON stay_pass_booking_cash_refund_sources BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r JOIN stay_pass_operations o ON o.id=r.id JOIN appointments a ON a.id=r.booking_id JOIN transactions t ON t.id=NEW.transaction_id
 WHERE r.id=NEW.record_id AND r.direction='refund' AND o.result IS NULL AND t.kind='income' AND t.customer_id=a.customer_id AND t.stay_id IS NULL
 AND ((t.deposit_appointment_id=a.id AND t.payment_type='deposit') OR EXISTS(SELECT 1 FROM stay_pass_booking_cash_records source WHERE source.transaction_id=t.id AND source.booking_id=a.id AND source.direction='receive'))
 AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM stay_pass_booking_cash_refund_sources WHERE transaction_id=t.id),0)<=ROUND(t.amount*100))
 THEN RAISE(ABORT,'stay_pass_booking_cash_source_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_no_update BEFORE UPDATE ON stay_pass_booking_cash_records BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_no_delete BEFORE DELETE ON stay_pass_booking_cash_records BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_source_no_update BEFORE UPDATE ON stay_pass_booking_cash_refund_sources BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_source_no_delete BEFORE DELETE ON stay_pass_booking_cash_refund_sources BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_finalize BEFORE UPDATE OF result ON stay_pass_operations
 WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND NEW.kind='booking_cash_followup' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r WHERE r.id=NEW.id AND (r.direction='receive' AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_refund_sources WHERE record_id=r.id) OR r.direction='refund' AND r.amount_cents=(SELECT SUM(amount_cents) FROM stay_pass_booking_cash_refund_sources WHERE record_id=r.id)))
 OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions WHERE operation_id=NEW.id)
 THEN RAISE(ABORT,'stay_pass_booking_cash_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_tx_no_update BEFORE UPDATE ON transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_cash_records WHERE transaction_id=OLD.id OR booking_id=OLD.deposit_appointment_id)
 OR EXISTS(SELECT 1 FROM stay_pass_booking_cash_refund_sources WHERE transaction_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_cash_receipt_locked');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_cash_tx_no_delete BEFORE DELETE ON transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_cash_records WHERE transaction_id=OLD.id OR booking_id=OLD.deposit_appointment_id)
 OR EXISTS(SELECT 1 FROM stay_pass_booking_cash_refund_sources WHERE transaction_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_cash_receipt_locked');END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(14,CURRENT_TIMESTAMP);
