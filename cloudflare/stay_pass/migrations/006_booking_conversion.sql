-- Development only: an immutable link preserves the original booking's cash total.
CREATE TABLE IF NOT EXISTS stay_pass_booking_links(
 booking_id INTEGER PRIMARY KEY REFERENCES appointments(id),pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 hold_operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_booking_settlements(id),
 original_total_cents INTEGER NOT NULL CHECK(typeof(original_total_cents)='integer' AND original_total_cents>=0),
 cash_cents INTEGER NOT NULL CHECK(typeof(cash_cents)='integer' AND cash_cents>=0),
 converted_revision TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_link_guard BEFORE INSERT ON stay_pass_booking_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_booking_settlements s JOIN stay_pass_operations o ON o.id=s.id
  WHERE s.id=NEW.hold_operation_id AND s.booking_id=NEW.booking_id AND s.pass_id=NEW.pass_id AND s.cash_cents=NEW.cash_cents AND o.result IS NULL)
 THEN RAISE(ABORT,'stay_pass_conversion_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_link_no_update BEFORE UPDATE ON stay_pass_booking_links BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_link_no_delete BEFORE DELETE ON stay_pass_booking_links BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TABLE IF NOT EXISTS stay_pass_checkin_commits(
 booking_id INTEGER PRIMARY KEY REFERENCES stay_pass_booking_links(booking_id),
 stay_id INTEGER NOT NULL UNIQUE REFERENCES stays(id),operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),
 request_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS stay_pass_checkin_commit_guard BEFORE INSERT ON stay_pass_checkin_commits BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links l ON l.pass_id=o.pass_id
  WHERE o.id=NEW.operation_id AND l.booking_id=NEW.booking_id AND o.result IS NULL AND o.kind IN('stay_consumption','daycare_consumption'))
 THEN RAISE(ABORT,'stay_pass_checkin_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_checkin_no_update BEFORE UPDATE ON stay_pass_checkin_commits BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_checkin_no_delete BEFORE DELETE ON stay_pass_checkin_commits BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
-- Old cash-only editors must not overwrite a converted booking or its credit allocation.
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_edit_lock BEFORE UPDATE ON appointments
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_links l JOIN stay_pass_operations o ON o.id=l.hold_operation_id
  WHERE l.booking_id=OLD.id AND o.result IS NULL AND NEW.cloud_revision=l.converted_revision AND ROUND(NEW.agreed_total*100)=l.cash_cents)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_checkin_commits c JOIN stay_pass_operations o ON o.id=c.operation_id
  WHERE c.booking_id=OLD.id AND c.stay_id=NEW.stay_id AND o.result IS NULL)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_dog_insert_lock BEFORE INSERT ON appointment_dogs
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=NEW.appointment_id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_dog_update_lock BEFORE UPDATE ON appointment_dogs
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id OR booking_id=NEW.appointment_id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_dog_delete_lock BEFORE DELETE ON appointment_dogs
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_clock_update_lock BEFORE UPDATE ON boarding_charges
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id OR booking_id=NEW.appointment_id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_clock_delete_lock BEFORE DELETE ON boarding_charges
 WHEN EXISTS(SELECT 1 FROM stay_pass_booking_links WHERE booking_id=OLD.appointment_id)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_price_lock BEFORE UPDATE OF agreed_total,charged_nights,customer_id,checkin,checkout ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.agreed_total IS NOT OLD.agreed_total OR NEW.charged_nights IS NOT OLD.charged_nights OR NEW.customer_id IS NOT OLD.customer_id OR NEW.checkin IS NOT OLD.checkin OR NEW.checkout IS NOT OLD.checkout)
 BEGIN SELECT RAISE(ABORT,'stay_pass_booking_locked'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_stay_cancel_lock BEFORE UPDATE OF status,cancelled_at ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.status='cancelled' OR NEW.cancelled_at IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'stay_pass_cancellation_review_required'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(6,CURRENT_TIMESTAMP);
