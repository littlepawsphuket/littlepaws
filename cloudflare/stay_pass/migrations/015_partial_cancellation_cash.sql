-- Reviewed excess-deposit refunds before check-in of a partially cancelled Pass booking.
CREATE TABLE IF NOT EXISTS stay_pass_precheckin_cash(
 booking_id INTEGER PRIMARY KEY REFERENCES appointments(id),stay_id INTEGER NOT NULL UNIQUE REFERENCES stays(id),
 operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),refunded_cents INTEGER NOT NULL CHECK(typeof(refunded_cents)='integer' AND refunded_cents>0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_precheckin_cash_guard BEFORE INSERT ON stay_pass_precheckin_cash BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links b ON b.pass_id=o.pass_id JOIN appointments a ON a.id=b.booking_id JOIN stays s ON s.id=NEW.stay_id
 WHERE o.id=NEW.operation_id AND o.result IS NULL AND o.kind IN('stay_consumption','daycare_consumption') AND a.id=NEW.booking_id AND a.status='pending' AND a.stay_id IS NULL AND s.customer_id=a.customer_id AND s.status='checked_in'
 AND NEW.refunded_cents=(SELECT SUM(r.amount_cents) FROM stay_pass_booking_cash_records r WHERE r.booking_id=a.id AND r.direction='refund')
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r WHERE r.booking_id=a.id AND r.direction!='refund')) THEN RAISE(ABORT,'stay_pass_precheckin_cash_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_precheckin_cash_no_update BEFORE UPDATE ON stay_pass_precheckin_cash BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_precheckin_cash_no_delete BEFORE DELETE ON stay_pass_precheckin_cash BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
DROP TRIGGER IF EXISTS stay_pass_booking_cash_insert_guard;
CREATE TRIGGER stay_pass_booking_cash_insert_guard BEFORE INSERT ON stay_pass_booking_cash_records BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_cancellations c ON c.id=NEW.cancellation_id JOIN appointments a ON a.id=c.booking_id JOIN transactions t ON t.id=NEW.transaction_id
 WHERE o.id=NEW.id AND o.kind='booking_cash_followup' AND o.result IS NULL AND o.pass_id=c.pass_id AND c.booking_id=NEW.booking_id AND ((c.remaining_dogs=0 AND a.status='cancelled') OR (c.remaining_dogs>0 AND a.status='pending' AND NEW.direction='refund')) AND a.stay_id IS NULL AND ROUND(a.agreed_total*100)=NEW.charge_cents AND c.cash_after_cents=NEW.charge_cents
 AND t.customer_id=a.customer_id AND t.kind=CASE NEW.direction WHEN 'receive' THEN 'income' ELSE 'refund' END AND ROUND(t.amount*100)=NEW.amount_cents AND t.payment_key=o.request_key AND t.stay_id IS NULL AND t.deposit_appointment_id IS NULL AND t.payment_type='')
 THEN RAISE(ABORT,'stay_pass_booking_cash_mismatch') END;
END;
DROP TRIGGER IF EXISTS stay_pass_booking_cash_tx_no_update;
CREATE TRIGGER stay_pass_booking_cash_tx_no_update BEFORE UPDATE ON transactions
 WHEN (EXISTS(SELECT 1 FROM stay_pass_booking_cash_records WHERE transaction_id=OLD.id OR booking_id=OLD.deposit_appointment_id)
 OR EXISTS(SELECT 1 FROM stay_pass_booking_cash_refund_sources WHERE transaction_id=OLD.id))
 AND NOT EXISTS(SELECT 1 FROM stay_pass_precheckin_cash c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE o.result IS NULL AND OLD.stay_id IS NULL AND NEW.stay_id=c.stay_id AND (OLD.deposit_appointment_id=c.booking_id OR EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r WHERE r.booking_id=c.booking_id AND r.transaction_id=OLD.id)) AND NEW.amount IS OLD.amount AND NEW.kind IS OLD.kind AND NEW.payment_type IS OLD.payment_type AND NEW.payment_key IS OLD.payment_key AND NEW.customer_id IS OLD.customer_id AND NEW.deposit_appointment_id IS OLD.deposit_appointment_id AND NEW.occurred_on IS OLD.occurred_on AND NEW.received_time IS OLD.received_time AND NEW.reference IS OLD.reference AND NEW.payment_method IS OLD.payment_method AND NEW.description IS OLD.description AND NEW.category IS OLD.category)
 BEGIN SELECT RAISE(ABORT,'stay_pass_cash_receipt_locked');END;

CREATE TRIGGER IF NOT EXISTS stay_pass_precheckin_cash_finalize BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND EXISTS(SELECT 1 FROM stay_pass_precheckin_cash WHERE operation_id=NEW.id) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_precheckin_cash c JOIN stay_pass_checkin_commits k ON k.booking_id=c.booking_id AND k.stay_id=c.stay_id AND k.operation_id=c.operation_id JOIN boarding_charges b ON b.stay_id=c.stay_id
 WHERE c.operation_id=NEW.id AND json_extract(b.details,'$.stay_pass.precheckin_cash_adjustment_cents')=-c.refunded_cents
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r JOIN transactions t ON t.id=r.transaction_id WHERE r.booking_id=c.booking_id AND (t.stay_id IS NOT c.stay_id OR t.kind!='refund' OR ROUND(t.amount*100)!=r.amount_cents))) THEN RAISE(ABORT,'stay_pass_precheckin_cash_mismatch') END;
END;
DROP TRIGGER IF EXISTS stay_pass_booking_clock_update_lock;
CREATE TRIGGER stay_pass_booking_clock_update_lock BEFORE UPDATE ON boarding_charges
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id OR booking_id=NEW.appointment_id)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cash_records r JOIN stay_pass_operations o ON o.id=r.id JOIN appointments a ON a.id=r.booking_id
 WHERE r.booking_id=OLD.appointment_id AND o.kind='booking_cash_followup' AND o.result IS NULL AND a.status='pending' AND a.stay_id IS NULL AND r.direction='refund'
 AND NEW.appointment_id IS OLD.appointment_id AND NEW.stay_id IS OLD.stay_id
 AND json_remove(NEW.details,'$.booking_cash_adjustment_cents')=json_remove(OLD.details,'$.booking_cash_adjustment_cents')
 AND json_extract(NEW.details,'$.booking_cash_adjustment_cents')=-(SELECT SUM(amount_cents) FROM stay_pass_booking_cash_records WHERE booking_id=a.id AND direction='refund'))
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked');END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(15,CURRENT_TIMESTAMP);
