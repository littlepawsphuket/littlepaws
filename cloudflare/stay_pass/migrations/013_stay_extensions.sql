-- Development-only additive planned Stay Pass extensions. No legacy agreement is rewritten.
CREATE TABLE IF NOT EXISTS stay_pass_stay_extensions(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),stay_id INTEGER NOT NULL REFERENCES stay_pass_checkin_commits(stay_id),
 sequence INTEGER NOT NULL CHECK(sequence>0),quote_hash TEXT NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),after_snapshot TEXT NOT NULL CHECK(json_valid(after_snapshot)),
 before_total_cents INTEGER NOT NULL CHECK(typeof(before_total_cents)='integer' AND before_total_cents>=0),total_cents INTEGER NOT NULL CHECK(typeof(total_cents)='integer' AND total_cents>=before_total_cents),
 quantity100 INTEGER NOT NULL CHECK(typeof(quantity100)='integer' AND quantity100>=100 AND quantity100%100=0),checkout_day TEXT NOT NULL,checkout_at TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(stay_id,sequence)
);
CREATE TRIGGER IF NOT EXISTS stay_pass_extension_insert_guard BEFORE INSERT ON stay_pass_stay_extensions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id JOIN stays s ON s.id=c.stay_id WHERE o.id=NEW.id AND o.kind='stay_extension' AND o.result IS NULL AND o.pass_id=b.pass_id AND s.status='checked_in' AND s.cancelled_at IS NULL AND ROUND(s.agreed_total*100)=NEW.before_total_cents AND NEW.sequence=1+COALESCE((SELECT MAX(sequence) FROM stay_pass_stay_extensions WHERE stay_id=NEW.stay_id),0)) THEN RAISE(ABORT,'stay_pass_extension_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_extension_no_update BEFORE UPDATE ON stay_pass_stay_extensions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_extension_no_delete BEFORE DELETE ON stay_pass_stay_extensions BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
DROP TRIGGER IF EXISTS stay_pass_stay_price_lock;
CREATE TRIGGER stay_pass_stay_price_lock BEFORE UPDATE OF agreed_total,charged_nights,customer_id,checkin,checkout ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.agreed_total IS NOT OLD.agreed_total OR NEW.charged_nights IS NOT OLD.charged_nights OR NEW.customer_id IS NOT OLD.customer_id OR NEW.checkin IS NOT OLD.checkin OR NEW.checkout IS NOT OLD.checkout)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_checkout_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE c.stay_id=OLD.id AND o.result IS NULL AND NEW.customer_id=OLD.customer_id AND NEW.checkin=OLD.checkin AND NEW.status='completed' AND NEW.actual_checkout_at=c.actual_checkout_at AND ROUND(NEW.agreed_total*100)=c.total_cents AND NEW.charged_nights*100=c.quantity100 AND NEW.checkout=c.checkout_day)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_stay_extensions e JOIN stay_pass_operations o ON o.id=e.id WHERE e.stay_id=OLD.id AND o.kind='stay_extension' AND o.result IS NULL AND NEW.customer_id=OLD.customer_id AND NEW.checkin=OLD.checkin AND NEW.status=OLD.status AND NEW.status='checked_in' AND NEW.actual_checkout_at IS OLD.actual_checkout_at AND ROUND(NEW.agreed_total*100)=e.total_cents AND NEW.charged_nights*100=e.quantity100 AND NEW.checkout=e.checkout_day)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
DROP TRIGGER IF EXISTS stay_pass_credit_operation_kind;
CREATE TRIGGER stay_pass_credit_operation_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND kind!=NEW.kind)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id WHERE o.id=NEW.operation_id AND o.kind='checkout_reconciliation' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0 AND ((NEW.kind='credit_restoration' AND NEW.delta_units>0) OR (NEW.kind='stay_consumption' AND NEW.delta_units<0)))
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links b ON b.pass_id=o.pass_id WHERE o.id=NEW.operation_id AND o.kind='booking_cancellation' AND o.result IS NULL AND NEW.booking_id=b.booking_id AND NEW.stay_id IS NULL AND NEW.kind IN('cancellation_deduction','no_show_deduction') AND NEW.delta_units<=0 AND NEW.delta_reserved<0 AND NEW.delta_refund_held=0)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id WHERE o.id=NEW.operation_id AND o.kind='stay_extension' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.kind='stay_consumption' AND NEW.delta_units<0 AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0)
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_kind_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_extension_finalize BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND NEW.kind='stay_extension' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_stay_extensions e JOIN stays s ON s.id=e.stay_id WHERE e.id=NEW.id AND s.status='checked_in' AND s.cancelled_at IS NULL AND s.checkout=e.checkout_day AND s.actual_checkout_at IS NULL AND ROUND(s.agreed_total*100)=e.total_cents AND s.charged_nights*100=e.quantity100
 AND (SELECT COUNT(*) FROM json_each(e.after_snapshot,'$.settlement.rows'))=(SELECT COUNT(*) FROM stay_dogs WHERE stay_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM json_each(e.after_snapshot,'$.settlement.rows') j WHERE j.value->>'covered_units'!=COALESCE((SELECT SUM(a.consumed_units) FROM stay_pass_booking_allocations a JOIN stay_pass_checkin_commits c ON c.booking_id=a.booking_id WHERE c.stay_id=s.id AND a.dog_id=j.value->>'dog_id'),0))
 AND json_extract((SELECT details FROM boarding_charges WHERE stay_id=s.id),'$.stay_pass.settlement.covered_units')=json_extract(e.after_snapshot,'$.settlement.covered_units')) THEN RAISE(ABORT,'stay_pass_extension_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(13,CURRENT_TIMESTAMP);
