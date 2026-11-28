-- Additive development migration: frozen allocation and cash quote, no cash receipt.
CREATE TABLE IF NOT EXISTS stay_pass_booking_settlements(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),
 pass_id TEXT NOT NULL REFERENCES stay_passes(id),booking_id INTEGER NOT NULL REFERENCES appointments(id),
 quote_hash TEXT NOT NULL CHECK(length(quote_hash)=64),
 covered_units INTEGER NOT NULL CHECK(typeof(covered_units)='integer' AND covered_units>0),
 cash_units INTEGER NOT NULL CHECK(typeof(cash_units)='integer' AND cash_units>=0),
 cash_cents INTEGER NOT NULL CHECK(typeof(cash_cents)='integer' AND cash_cents>=0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,
 CHECK(json_extract(snapshot,'$.settlement.covered_units')=covered_units),
 CHECK(json_extract(snapshot,'$.settlement.cash_units')=cash_units),
 CHECK(json_extract(snapshot,'$.settlement.cash_cents')=cash_cents)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_settlement_booking ON stay_pass_booking_settlements(booking_id,created_at);
CREATE TRIGGER IF NOT EXISTS stay_pass_settlement_guard BEFORE INSERT ON stay_pass_booking_settlements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o WHERE o.id=NEW.id AND o.pass_id=NEW.pass_id AND o.kind='reservation_hold' AND o.result IS NULL)
 OR NEW.covered_units!=COALESCE((SELECT SUM(delta_reserved) FROM stay_pass_credit_transactions WHERE operation_id=NEW.id AND booking_id=NEW.booking_id),0)
 OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions WHERE operation_id=NEW.id AND booking_id IS NOT NEW.booking_id)
 OR json_extract(NEW.snapshot,'$.pass_id') IS NOT NEW.pass_id OR json_extract(NEW.snapshot,'$.booking_id') IS NOT NEW.booking_id
 OR NEW.covered_units!=COALESCE((SELECT SUM(value->>'covered_units') FROM json_each(NEW.snapshot,'$.settlement.rows')),0)
 OR NEW.cash_units!=COALESCE((SELECT SUM(value->>'cash_units') FROM json_each(NEW.snapshot,'$.settlement.rows')),0)
 OR NEW.cash_cents!=COALESCE((SELECT SUM(value->>'cash_cents') FROM json_each(NEW.snapshot,'$.settlement.rows')),0)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.settlement.rows') row WHERE row.value->>'covered_units'!=COALESCE(
  (SELECT SUM(reserved_delta) FROM stay_pass_booking_credit_events e WHERE e.operation_id=NEW.id AND e.dog_id=row.value->>'dog_id'),0))
 OR (SELECT count(*) FROM json_each(NEW.snapshot,'$.settlement.rows'))!=(SELECT count(DISTINCT value->>'dog_id') FROM json_each(NEW.snapshot,'$.settlement.rows'))
 THEN RAISE(ABORT,'stay_pass_settlement_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_settlement_no_update BEFORE UPDATE ON stay_pass_booking_settlements BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_settlement_no_delete BEFORE DELETE ON stay_pass_booking_settlements BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_operation_open BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND result IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_closed'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_booking_operation_open BEFORE INSERT ON stay_pass_booking_credit_events
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND result IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_closed'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_credit_operation_kind BEFORE INSERT ON stay_pass_credit_transactions
 WHEN EXISTS(SELECT 1 FROM stay_pass_operations WHERE id=NEW.operation_id AND kind!=NEW.kind)
 BEGIN SELECT RAISE(ABORT,'stay_pass_operation_kind_mismatch'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(5,CURRENT_TIMESTAMP);
