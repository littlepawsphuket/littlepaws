-- Audited full/partial-by-dog cancellations of pending Pass reservations.
CREATE TABLE IF NOT EXISTS stay_pass_booking_cancellations(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),pass_id TEXT NOT NULL REFERENCES stay_passes(id),booking_id INTEGER NOT NULL REFERENCES appointments(id),
 sequence INTEGER NOT NULL CHECK(sequence>0),cause TEXT NOT NULL CHECK(cause IN('customer','shop','no_show')),
 notified_at TEXT NOT NULL,notice_days INTEGER NOT NULL,standard_percent INTEGER NOT NULL CHECK(standard_percent IN(0,50,100)),
 applied_percent INTEGER NOT NULL CHECK(applied_percent IN(0,25,50,75,100) AND applied_percent<=standard_percent),
 override_reason TEXT NOT NULL,held_units INTEGER NOT NULL CHECK(held_units>=0),deduct_units INTEGER NOT NULL CHECK(deduct_units>=0 AND deduct_units<=held_units),
 release_units INTEGER NOT NULL CHECK(release_units=held_units-deduct_units),remaining_dogs INTEGER NOT NULL CHECK(remaining_dogs>=0),
 next_revision TEXT NOT NULL UNIQUE,remaining_snapshot TEXT CHECK(remaining_snapshot IS NULL OR json_valid(remaining_snapshot)),
 cash_before_cents INTEGER NOT NULL CHECK(typeof(cash_before_cents)='integer' AND cash_before_cents>=0),cash_fee_cents INTEGER NOT NULL CHECK(typeof(cash_fee_cents)='integer' AND cash_fee_cents>=0 AND cash_fee_cents<=cash_before_cents),cash_after_cents INTEGER NOT NULL CHECK(typeof(cash_after_cents)='integer' AND cash_after_cents>=0),paid_cents INTEGER NOT NULL CHECK(typeof(paid_cents)='integer' AND paid_cents>=0),cash_due_cents INTEGER NOT NULL CHECK(typeof(cash_due_cents)='integer' AND cash_due_cents=MAX(0,cash_after_cents-paid_cents)),cash_refund_review_cents INTEGER NOT NULL CHECK(typeof(cash_refund_review_cents)='integer' AND cash_refund_review_cents=MAX(0,paid_cents-cash_after_cents)),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,UNIQUE(booking_id,sequence)
);
CREATE TABLE IF NOT EXISTS stay_pass_cancellation_lines(
 operation_id TEXT NOT NULL REFERENCES stay_pass_booking_cancellations(id),ledger_id TEXT NOT NULL REFERENCES stay_pass_credit_transactions(id),
 lot_id TEXT NOT NULL REFERENCES stay_pass_credit_lots(id),dog_id INTEGER NOT NULL REFERENCES dogs(id),
 held_units INTEGER NOT NULL CHECK(typeof(held_units)='integer' AND held_units>0),deduct_units INTEGER NOT NULL CHECK(typeof(deduct_units)='integer' AND deduct_units>=0 AND deduct_units<=held_units),
 PRIMARY KEY(operation_id,lot_id,dog_id)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_cancellations ON stay_pass_booking_cancellations(pass_id,booking_id,sequence);
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_guard BEFORE INSERT ON stay_pass_booking_cancellations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links b ON b.pass_id=o.pass_id JOIN appointments a ON a.id=b.booking_id WHERE o.id=NEW.id AND o.pass_id=NEW.pass_id AND o.kind='booking_cancellation' AND o.result IS NULL AND a.id=NEW.booking_id AND a.status='pending' AND a.stay_id IS NULL)
 THEN RAISE(ABORT,'stay_pass_cancellation_mismatch') END;
 SELECT CASE WHEN NEW.remaining_dogs=0 AND NEW.remaining_snapshot IS NOT NULL OR NEW.remaining_dogs>0 AND NEW.remaining_snapshot IS NULL OR NEW.applied_percent<NEW.standard_percent AND length(trim(NEW.override_reason))=0
 THEN RAISE(ABORT,'stay_pass_cancellation_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_no_update BEFORE UPDATE ON stay_pass_booking_cancellations BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_no_delete BEFORE DELETE ON stay_pass_booking_cancellations BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_line_no_update BEFORE UPDATE ON stay_pass_cancellation_lines BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_line_no_delete BEFORE DELETE ON stay_pass_cancellation_lines BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
-- Preserve all previous conversion/check-in exceptions; permit only the reviewed cancellation revision.
DROP TRIGGER IF EXISTS stay_pass_booking_edit_lock;
CREATE TRIGGER stay_pass_booking_edit_lock BEFORE UPDATE ON appointments
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links b JOIN stay_pass_operations o ON o.id=b.hold_operation_id WHERE b.booking_id=OLD.id AND o.result IS NULL AND NEW.cloud_revision=b.converted_revision AND ROUND(NEW.agreed_total*100)=b.cash_cents)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_checkin_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE c.booking_id=OLD.id AND c.stay_id=NEW.stay_id AND o.result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cancellations c JOIN stay_pass_operations o ON o.id=c.id WHERE c.booking_id=OLD.id AND o.result IS NULL AND NEW.cloud_revision=c.next_revision AND NEW.status=CASE WHEN c.remaining_dogs=0 THEN 'cancelled' ELSE 'pending' END AND NEW.stay_id IS NULL AND NEW.customer_id=OLD.customer_id AND NEW.checkin=OLD.checkin AND NEW.checkout=OLD.checkout AND NEW.charged_nights=OLD.charged_nights AND ROUND(NEW.agreed_total*100)=c.cash_after_cents AND NEW.service_type=OLD.service_type AND NEW.discount_cents=OLD.discount_cents)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
DROP TRIGGER IF EXISTS stay_pass_booking_dog_delete_lock;
CREATE TRIGGER stay_pass_booking_dog_delete_lock BEFORE DELETE ON appointment_dogs
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_cancellations c JOIN stay_pass_operations o ON o.id=c.id CROSS JOIN json_each(c.snapshot,'$.dogs') dog WHERE c.booking_id=OLD.appointment_id AND dog.value->>'dog_id'=OLD.dog_id AND c.remaining_dogs>0 AND o.result IS NULL)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_ledger_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations o WHERE o.id=NEW.operation_id AND o.kind='booking_cancellation')
 AND (NEW.kind NOT IN('cancellation_deduction','no_show_deduction') OR NEW.delta_units>0 OR NEW.delta_reserved>=0 OR NEW.delta_refund_held!=0)
 BEGIN SELECT RAISE(ABORT,'stay_pass_cancellation_mismatch'); END;
-- Cancellation kinds retain their own ledger kinds while sharing one atomic operation.
DROP TRIGGER IF EXISTS stay_pass_credit_operation_kind;
CREATE TRIGGER stay_pass_credit_operation_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND kind!=NEW.kind)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id WHERE o.id=NEW.operation_id AND o.kind='checkout_reconciliation' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0 AND ((NEW.kind='credit_restoration' AND NEW.delta_units>0) OR (NEW.kind='stay_consumption' AND NEW.delta_units<0)))
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links b ON b.pass_id=o.pass_id WHERE o.id=NEW.operation_id AND o.kind='booking_cancellation' AND o.result IS NULL AND NEW.booking_id=b.booking_id AND NEW.stay_id IS NULL AND NEW.kind IN('cancellation_deduction','no_show_deduction') AND NEW.delta_units<=0 AND NEW.delta_reserved<0 AND NEW.delta_refund_held=0)
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_kind_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_line_guard BEFORE INSERT ON stay_pass_cancellation_lines BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t JOIN stay_pass_booking_cancellations c ON c.id=t.operation_id JOIN stay_pass_operations o ON o.id=c.id WHERE c.id=NEW.operation_id AND t.id=NEW.ledger_id AND t.lot_id=NEW.lot_id AND t.pass_id=c.pass_id AND t.booking_id=c.booking_id AND o.result IS NULL)
 THEN RAISE(ABORT,'stay_pass_cancellation_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_cancellation_finalize_guard BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND NEW.kind='booking_cancellation' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_booking_cancellations c JOIN appointments a ON a.id=c.booking_id WHERE c.id=NEW.id AND a.cloud_revision=c.next_revision AND a.stay_id IS NULL AND a.status=CASE WHEN c.remaining_dogs=0 THEN 'cancelled' ELSE 'pending' END
 AND ROUND(a.agreed_total*100)=c.cash_after_cents AND c.deduct_units=COALESCE((SELECT SUM(deduct_units) FROM stay_pass_cancellation_lines WHERE operation_id=c.id),0) AND c.held_units=COALESCE((SELECT SUM(held_units) FROM stay_pass_cancellation_lines WHERE operation_id=c.id),0)
 AND (c.remaining_dogs=0 OR c.remaining_dogs=(SELECT COUNT(*) FROM appointment_dogs WHERE appointment_id=c.booking_id)))
 OR EXISTS(SELECT 1 FROM stay_pass_cancellation_lines l JOIN stay_pass_booking_cancellations c ON c.id=l.operation_id JOIN stay_pass_booking_allocations a ON a.booking_id=c.booking_id AND a.dog_id=l.dog_id WHERE c.id=NEW.id AND (a.reserved_units!=0 OR a.consumed_units!=0))
 OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions t WHERE t.operation_id=NEW.id AND (-t.delta_units!=COALESCE((SELECT SUM(deduct_units) FROM stay_pass_cancellation_lines WHERE ledger_id=t.id),0) OR -t.delta_reserved!=COALESCE((SELECT SUM(held_units) FROM stay_pass_cancellation_lines WHERE ledger_id=t.id),0) OR t.delta_reserved!=COALESCE((SELECT SUM(reserved_delta) FROM stay_pass_booking_credit_events WHERE ledger_id=t.id),0) OR EXISTS(SELECT 1 FROM stay_pass_booking_credit_events e WHERE e.ledger_id=t.id AND e.consumed_delta!=0)))
 THEN RAISE(ABORT,'stay_pass_cancellation_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(12,CURRENT_TIMESTAMP);
