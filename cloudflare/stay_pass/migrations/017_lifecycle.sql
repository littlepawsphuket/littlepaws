CREATE TABLE IF NOT EXISTS stay_pass_lifecycle_events(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 kind TEXT NOT NULL CHECK(kind IN('expiration','extension')),old_expiry TEXT NOT NULL,new_expiry TEXT NOT NULL,
 units INTEGER NOT NULL CHECK(typeof(units)='integer' AND units>=0),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,
 CHECK((kind='expiration' AND new_expiry=old_expiry AND old_expiry<=created_at) OR (kind='extension' AND new_expiry>old_expiry AND new_expiry>created_at))
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_lifecycle ON stay_pass_lifecycle_events(pass_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS stay_pass_lifecycle_guard BEFORE INSERT ON stay_pass_lifecycle_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_passes p ON p.id=o.pass_id WHERE o.id=NEW.id AND o.pass_id=NEW.pass_id AND o.result IS NULL AND o.expected_revision=p.revision AND p.expires_at=NEW.old_expiry AND o.kind=CASE NEW.kind WHEN 'extension' THEN 'validity_extension' ELSE 'expiration' END) THEN RAISE(ABORT,'stay_pass_lifecycle_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lifecycle_no_update BEFORE UPDATE ON stay_pass_lifecycle_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lifecycle_no_delete BEFORE DELETE ON stay_pass_lifecycle_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_expiry_guard BEFORE UPDATE OF expires_at ON stay_passes WHEN NEW.expires_at!=OLD.expires_at BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_lifecycle_events e JOIN stay_pass_operations o ON o.id=e.id WHERE e.pass_id=OLD.id AND e.kind='extension' AND e.old_expiry=OLD.expires_at AND e.new_expiry=NEW.expires_at AND o.result IS NULL AND o.expected_revision=OLD.revision) THEN RAISE(ABORT,'stay_pass_extension_required') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lot_expiry_guard BEFORE UPDATE OF expires_at ON stay_pass_credit_lots WHEN NEW.expires_at!=OLD.expires_at BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_lifecycle_events e JOIN stay_pass_operations o ON o.id=e.id JOIN stay_passes p ON p.id=e.pass_id WHERE e.pass_id=OLD.pass_id AND e.kind='extension' AND e.old_expiry=OLD.expires_at AND e.new_expiry=NEW.expires_at AND o.result IS NULL AND o.expected_revision=p.revision) THEN RAISE(ABORT,'stay_pass_extension_required') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_lifecycle_finalize BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL AND NEW.kind IN('validity_extension','expiration') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_lifecycle_events e JOIN stay_passes p ON p.id=e.pass_id WHERE e.id=NEW.id AND p.expires_at=e.new_expiry
 AND ((e.kind='expiration' AND p.status='expired' AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND remaining_units>0) AND e.units=COALESCE((SELECT -SUM(delta_units) FROM stay_pass_credit_transactions WHERE operation_id=NEW.id AND kind='expiration'),0))
 OR (e.kind='extension' AND e.units=COALESCE((SELECT SUM(delta_units) FROM stay_pass_credit_transactions WHERE operation_id=NEW.id),0) AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t LEFT JOIN stay_pass_credit_transactions original ON original.id=t.reversal_of WHERE t.operation_id=NEW.id AND (t.kind!='reversal' OR original.kind!='expiration' OR original.id IS NULL)) AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots WHERE pass_id=p.id AND expires_at!=e.new_expiry)))) THEN RAISE(ABORT,'stay_pass_lifecycle_mismatch') END;
END;
DROP TRIGGER IF EXISTS stay_pass_credit_operation_kind;
CREATE TRIGGER stay_pass_credit_operation_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND kind!=NEW.kind)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id WHERE o.id=NEW.operation_id AND o.kind='checkout_reconciliation' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0 AND ((NEW.kind='credit_restoration' AND NEW.delta_units>0) OR (NEW.kind='stay_consumption' AND NEW.delta_units<0)))
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_booking_links b ON b.pass_id=o.pass_id WHERE o.id=NEW.operation_id AND o.kind='booking_cancellation' AND o.result IS NULL AND NEW.booking_id=b.booking_id AND NEW.stay_id IS NULL AND NEW.kind IN('cancellation_deduction','no_show_deduction') AND NEW.delta_units<=0 AND NEW.delta_reserved<0 AND NEW.delta_refund_held=0)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_checkin_commits c ON c.stay_id=NEW.stay_id JOIN stay_pass_booking_links b ON b.booking_id=c.booking_id WHERE o.id=NEW.operation_id AND o.kind='stay_extension' AND o.pass_id=b.pass_id AND o.result IS NULL AND NEW.booking_id=c.booking_id AND NEW.kind='stay_consumption' AND NEW.delta_units<0 AND NEW.delta_reserved=0 AND NEW.delta_refund_held=0)
 AND NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_pass_lifecycle_events e ON e.id=o.id JOIN stay_pass_credit_transactions original ON original.id=NEW.reversal_of WHERE o.id=NEW.operation_id AND o.kind='validity_extension' AND o.result IS NULL AND e.kind='extension' AND e.units>0 AND original.kind='expiration' AND original.pass_id=o.pass_id AND NEW.kind='reversal' AND NEW.pass_id=o.pass_id AND NEW.booking_id IS NULL AND NEW.stay_id IS NULL AND EXISTS(SELECT 1 FROM json_each(e.snapshot,'$.expired_entries') j WHERE j.value->>'id'=original.id))
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_kind_mismatch'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(17,CURRENT_TIMESTAMP);
