-- Immutable per-dog attribution of the aggregate lot ledger. No legacy booking is repriced.
CREATE TABLE IF NOT EXISTS stay_pass_booking_credit_events(
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES stay_pass_operations(id),
 ledger_id TEXT NOT NULL REFERENCES stay_pass_credit_transactions(id),
 pass_id TEXT NOT NULL REFERENCES stay_passes(id), lot_id TEXT NOT NULL REFERENCES stay_pass_credit_lots(id),
 booking_id INTEGER NOT NULL REFERENCES appointments(id), dog_id INTEGER NOT NULL REFERENCES dogs(id),
 reserved_delta INTEGER NOT NULL, consumed_delta INTEGER NOT NULL, recorded_at TEXT NOT NULL,
 reversal_of TEXT UNIQUE REFERENCES stay_pass_booking_credit_events(id),
 UNIQUE(ledger_id,dog_id), CHECK(reserved_delta!=0 OR consumed_delta!=0)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_booking_credit ON stay_pass_booking_credit_events(booking_id,pass_id,dog_id,lot_id);
CREATE VIEW IF NOT EXISTS stay_pass_booking_allocations AS
 SELECT pass_id,lot_id,booking_id,dog_id,SUM(reserved_delta) reserved_units,SUM(consumed_delta) consumed_units
 FROM stay_pass_booking_credit_events GROUP BY pass_id,lot_id,booking_id,dog_id;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_event_guard BEFORE INSERT ON stay_pass_booking_credit_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t WHERE t.id=NEW.ledger_id
   AND t.operation_id=NEW.operation_id AND t.pass_id=NEW.pass_id AND t.lot_id=NEW.lot_id AND t.booking_id=NEW.booking_id
   AND (t.dog_id IS NULL OR t.dog_id=NEW.dog_id)) THEN RAISE(ABORT,'stay_pass_allocation_reference') END;
 SELECT CASE WHEN COALESCE((SELECT reserved_units FROM stay_pass_booking_allocations WHERE pass_id=NEW.pass_id AND lot_id=NEW.lot_id AND booking_id=NEW.booking_id AND dog_id=NEW.dog_id),0)+NEW.reserved_delta<0
   OR COALESCE((SELECT consumed_units FROM stay_pass_booking_allocations WHERE pass_id=NEW.pass_id AND lot_id=NEW.lot_id AND booking_id=NEW.booking_id AND dog_id=NEW.dog_id),0)+NEW.consumed_delta<0
   THEN RAISE(ABORT,'stay_pass_allocation_balance') END;
 SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stay_pass_booking_credit_events e
   WHERE e.id=NEW.reversal_of AND e.pass_id=NEW.pass_id AND e.lot_id=NEW.lot_id AND e.booking_id=NEW.booking_id AND e.dog_id=NEW.dog_id
   AND NEW.reserved_delta=-e.reserved_delta AND NEW.consumed_delta=-e.consumed_delta)
   THEN RAISE(ABORT,'stay_pass_allocation_reversal') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_event_no_update BEFORE UPDATE ON stay_pass_booking_credit_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_event_no_delete BEFORE DELETE ON stay_pass_booking_credit_events BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_operation_guard BEFORE UPDATE OF result ON stay_pass_operations WHEN NEW.result IS NOT NULL AND OLD.result IS NULL BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM stay_pass_credit_transactions t WHERE t.operation_id=NEW.id AND t.booking_id IS NOT NULL
   AND t.kind IN('reservation_hold','reservation_release','stay_consumption','daycare_consumption','reversal')
   AND (t.delta_reserved!=COALESCE((SELECT SUM(e.reserved_delta) FROM stay_pass_booking_credit_events e WHERE e.ledger_id=t.id),0)
    OR -t.delta_units!=COALESCE((SELECT SUM(e.consumed_delta) FROM stay_pass_booking_credit_events e WHERE e.ledger_id=t.id),0)))
   THEN RAISE(ABORT,'stay_pass_allocation_ledger_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_operation_done_no_update BEFORE UPDATE ON stay_pass_operations WHEN OLD.result IS NOT NULL BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_operation_no_delete BEFORE DELETE ON stay_pass_operations BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions(version,applied_at) VALUES(3,CURRENT_TIMESTAMP);
