-- Audited, one-time checkout reconciliation. Original booking/check-in snapshots remain immutable.
CREATE TABLE IF NOT EXISTS stay_pass_checkout_commits(
 stay_id INTEGER PRIMARY KEY REFERENCES stay_pass_checkin_commits(stay_id),
 operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),
 quote_hash TEXT NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 original_total_cents INTEGER NOT NULL CHECK(typeof(original_total_cents)='integer' AND original_total_cents>=0),
 total_cents INTEGER NOT NULL CHECK(typeof(total_cents)='integer' AND total_cents>=0),
 quantity100 INTEGER NOT NULL CHECK(typeof(quantity100)='integer' AND quantity100>=100 AND quantity100%100=0),
 checkout_day TEXT NOT NULL,actual_checkout_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_checkout_commit_guard BEFORE INSERT ON stay_pass_checkout_commits BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id JOIN stays s ON s.id=c.stay_id
 WHERE o.id=NEW.operation_id AND o.kind='checkout_reconciliation' AND o.result IS NULL AND o.pass_id=b.pass_id AND s.status='checked_in' AND s.cancelled_at IS NULL AND ROUND(s.agreed_total*100)=NEW.original_total_cents)
 THEN RAISE(ABORT,'stay_pass_checkout_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_checkout_no_update BEFORE UPDATE ON stay_pass_checkout_commits BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_checkout_no_delete BEFORE DELETE ON stay_pass_checkout_commits BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
DROP TRIGGER IF EXISTS stay_pass_checkout_review_lock;
CREATE TRIGGER stay_pass_checkout_review_lock BEFORE UPDATE OF status,actual_checkout_at ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.status='completed' OR NEW.actual_checkout_at IS NOT OLD.actual_checkout_at)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_checkout_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE c.stay_id=OLD.id AND o.result IS NULL AND NEW.status='completed' AND NEW.actual_checkout_at=c.actual_checkout_at AND ROUND(NEW.agreed_total*100)=c.total_cents AND NEW.charged_nights*100=c.quantity100 AND NEW.checkout=c.checkout_day)
 BEGIN SELECT RAISE(ABORT,'stay_pass_checkout_review_required'); END;
DROP TRIGGER IF EXISTS stay_pass_stay_price_lock;
CREATE TRIGGER stay_pass_stay_price_lock BEFORE UPDATE OF agreed_total,charged_nights,customer_id,checkin,checkout ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.agreed_total IS NOT OLD.agreed_total OR NEW.charged_nights IS NOT OLD.charged_nights OR NEW.customer_id IS NOT OLD.customer_id OR NEW.checkin IS NOT OLD.checkin OR NEW.checkout IS NOT OLD.checkout)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_checkout_commits c JOIN stay_pass_operations o ON o.id=c.operation_id WHERE c.stay_id=OLD.id AND o.result IS NULL AND NEW.customer_id=OLD.customer_id AND NEW.checkin=OLD.checkin AND NEW.status='completed' AND NEW.actual_checkout_at=c.actual_checkout_at AND ROUND(NEW.agreed_total*100)=c.total_cents AND NEW.charged_nights*100=c.quantity100 AND NEW.checkout=c.checkout_day)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_checkout_finalize_guard BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND NEW.kind='checkout_reconciliation' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_checkout_commits c JOIN stays s ON s.id=c.stay_id WHERE c.operation_id=NEW.id AND s.status='completed' AND s.actual_checkout_at=c.actual_checkout_at AND ROUND(s.agreed_total*100)=c.total_cents AND s.charged_nights*100=c.quantity100)
 OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions t WHERE t.operation_id=NEW.id AND (t.delta_reserved!=0 OR t.delta_refund_held!=0 OR t.kind NOT IN('stay_consumption','credit_restoration') OR -t.delta_units!=COALESCE((SELECT SUM(e.consumed_delta) FROM stay_pass_booking_credit_events e WHERE e.ledger_id=t.id),0)))
 THEN RAISE(ABORT,'stay_pass_checkout_mismatch') END;
END;
DROP TRIGGER IF EXISTS stay_pass_credit_operation_kind;
CREATE TRIGGER stay_pass_credit_operation_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND kind!=NEW.kind)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id
 WHERE o.id=NEW.operation_id AND o.kind='checkout_reconciliation' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0
 AND ((NEW.kind='credit_restoration' AND NEW.delta_units>0) OR (NEW.kind='stay_consumption' AND NEW.delta_units<0)))
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_kind_mismatch'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(11,CURRENT_TIMESTAMP);
