-- Additive only. New paid sale and both sides of carry commit in one D1 batch.
CREATE TABLE IF NOT EXISTS stay_pass_renewals(
 id TEXT PRIMARY KEY,old_pass_id TEXT NOT NULL UNIQUE REFERENCES stay_passes(id),
 new_pass_id TEXT NOT NULL UNIQUE REFERENCES stay_passes(id),
 source_operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),
 target_operation_id TEXT NOT NULL UNIQUE REFERENCES stay_pass_operations(id),
 carried_units INTEGER NOT NULL CHECK(typeof(carried_units)='integer' AND carried_units BETWEEN 0 AND 12),
 origin_value_cents INTEGER NOT NULL CHECK(typeof(origin_value_cents)='integer' AND origin_value_cents>=0),
 old_excess_units INTEGER NOT NULL CHECK(typeof(old_excess_units)='integer' AND old_excess_units>=0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),recorded_at TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES app_users(id),reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 CHECK(old_pass_id!=new_pass_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_stay_pass_carry_origin ON stay_pass_credit_lots(pass_id,source_lot_id) WHERE source_kind='carry_forward';
CREATE INDEX IF NOT EXISTS ix_stay_pass_renewal_time ON stay_pass_renewals(recorded_at,id);
CREATE TRIGGER IF NOT EXISTS stay_pass_renewal_validate BEFORE INSERT ON stay_pass_renewals BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_passes old JOIN stay_passes fresh ON fresh.id=NEW.new_pass_id
  JOIN stay_pass_operations outgoing ON outgoing.id=NEW.source_operation_id AND outgoing.pass_id=old.id AND outgoing.kind='renewal_transfer_out'
  JOIN stay_pass_operations incoming ON incoming.id=NEW.target_operation_id AND incoming.pass_id=fresh.id AND incoming.kind='renewal_carry_forward'
  WHERE old.id=NEW.old_pass_id AND old.customer_id=fresh.customer_id AND old.size=fresh.size
   AND fresh.purchase_at<old.expires_at AND outgoing.result IS NULL AND incoming.result IS NULL
   AND NEW.carried_units=-(SELECT COALESCE(SUM(delta_units),0) FROM stay_pass_credit_transactions WHERE operation_id=outgoing.id)
   AND NEW.carried_units=(SELECT COALESCE(SUM(delta_units),0) FROM stay_pass_credit_transactions WHERE operation_id=incoming.id)
   AND NEW.origin_value_cents=(SELECT COALESCE(SUM(origin_value_cents),0) FROM stay_pass_credit_lots WHERE pass_id=fresh.id AND source_kind='carry_forward')
   AND NOT EXISTS(SELECT 1 FROM stay_pass_credit_lots target LEFT JOIN stay_pass_credit_lots source ON source.id=target.source_lot_id
    WHERE target.pass_id=fresh.id AND target.source_kind='carry_forward' AND (source.id IS NULL OR source.pass_id!=old.id OR target.expires_at!=fresh.expires_at
     OR target.origin_value_cents*source.issued_units!=source.origin_value_cents*target.issued_units
     OR NOT EXISTS(SELECT 1 FROM stay_pass_credit_transactions t WHERE t.operation_id=outgoing.id AND t.lot_id=source.id AND t.kind='renewal_transfer_out' AND -t.delta_units=target.issued_units)))
   AND NEW.old_excess_units=(SELECT COALESCE(SUM(remaining_units),0) FROM stay_pass_credit_lots WHERE pass_id=old.id))
  THEN RAISE(ABORT,'stay_pass_renewal_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_renewal_no_update BEFORE UPDATE ON stay_pass_renewals BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
CREATE TRIGGER IF NOT EXISTS stay_pass_renewal_no_delete BEFORE DELETE ON stay_pass_renewals BEGIN SELECT RAISE(ABORT,'stay_pass_immutable'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions(version,applied_at) VALUES(8,CURRENT_TIMESTAMP);
