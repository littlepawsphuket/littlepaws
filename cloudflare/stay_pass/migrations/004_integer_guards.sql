-- Quarter-day units and satang must remain integers even if a future caller bypasses form validation.
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_integer_insert BEFORE INSERT ON stay_pass_credit_lots
 WHEN typeof(NEW.issued_units)!='integer' OR typeof(NEW.origin_value_cents)!='integer' OR typeof(NEW.remaining_units)!='integer' OR typeof(NEW.reserved_units)!='integer' OR typeof(NEW.refund_held_units)!='integer'
 BEGIN SELECT RAISE(ABORT,'stay_pass_integer_required'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_integer_update BEFORE UPDATE ON stay_pass_credit_lots
 WHEN typeof(NEW.issued_units)!='integer' OR typeof(NEW.origin_value_cents)!='integer' OR typeof(NEW.remaining_units)!='integer' OR typeof(NEW.reserved_units)!='integer' OR typeof(NEW.refund_held_units)!='integer'
 BEGIN SELECT RAISE(ABORT,'stay_pass_integer_required'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_integer BEFORE INSERT ON stay_pass_credit_transactions
 WHEN typeof(NEW.delta_units)!='integer' OR typeof(NEW.delta_reserved)!='integer' OR typeof(NEW.delta_refund_held)!='integer'
 OR typeof(NEW.before_units)!='integer' OR typeof(NEW.after_units)!='integer' OR typeof(NEW.before_reserved)!='integer' OR typeof(NEW.after_reserved)!='integer'
 OR typeof(NEW.before_refund_held)!='integer' OR typeof(NEW.after_refund_held)!='integer'
 BEGIN SELECT RAISE(ABORT,'stay_pass_integer_required'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_event_integer BEFORE INSERT ON stay_pass_booking_credit_events
 WHEN typeof(NEW.reserved_delta)!='integer' OR typeof(NEW.consumed_delta)!='integer'
 BEGIN SELECT RAISE(ABORT,'stay_pass_integer_required'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_payment_integer BEFORE INSERT ON stay_pass_payment_links
 WHEN typeof(NEW.amount_cents)!='integer' BEGIN SELECT RAISE(ABORT,'stay_pass_integer_required'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions(version,applied_at) VALUES(4,CURRENT_TIMESTAMP);
