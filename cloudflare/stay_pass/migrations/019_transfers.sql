CREATE TABLE IF NOT EXISTS stay_pass_transfers(
 id TEXT PRIMARY KEY REFERENCES stay_pass_operations(id),pass_id TEXT NOT NULL REFERENCES stay_passes(id),
 old_customer_id INTEGER NOT NULL REFERENCES customers(id),new_customer_id INTEGER NOT NULL REFERENCES customers(id),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),evidence TEXT NOT NULL CHECK(length(trim(evidence))>0),created_at TEXT NOT NULL,
 CHECK(old_customer_id!=new_customer_id)
);
CREATE INDEX IF NOT EXISTS ix_stay_pass_transfers ON stay_pass_transfers(pass_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS stay_pass_transfer_insert_guard BEFORE INSERT ON stay_pass_transfers BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_operations o JOIN stay_passes p ON p.id=o.pass_id JOIN customers c ON c.id=NEW.new_customer_id WHERE o.id=NEW.id AND o.result IS NULL AND o.kind='ownership_transfer' AND o.pass_id=NEW.pass_id AND o.expected_revision=p.revision AND p.customer_id=NEW.old_customer_id AND c.archived=0) THEN RAISE(ABORT,'stay_pass_transfer_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_transfer_no_update BEFORE UPDATE ON stay_pass_transfers BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_transfer_no_delete BEFORE DELETE ON stay_pass_transfers BEGIN SELECT RAISE(ABORT,'stay_pass_immutable');END;
CREATE TRIGGER IF NOT EXISTS stay_pass_owner_guard BEFORE UPDATE OF customer_id ON stay_passes WHEN NEW.customer_id!=OLD.customer_id BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_transfers t JOIN stay_pass_operations o ON o.id=t.id WHERE t.pass_id=OLD.id AND t.old_customer_id=OLD.customer_id AND t.new_customer_id=NEW.customer_id AND o.result IS NULL AND o.expected_revision=OLD.revision) THEN RAISE(ABORT,'stay_pass_transfer_required') END;
END;
CREATE TRIGGER IF NOT EXISTS stay_pass_transfer_finalize BEFORE UPDATE OF result ON stay_pass_operations WHEN OLD.result IS NULL AND NEW.result IS NOT NULL AND NEW.kind='ownership_transfer' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stay_pass_transfers t JOIN stay_passes p ON p.id=t.pass_id WHERE t.id=NEW.id AND p.customer_id=t.new_customer_id
 AND (SELECT COUNT(*) FROM stay_pass_pets WHERE pass_id=p.id)=json_array_length(t.snapshot,'$.new_pets')
 AND NOT EXISTS(SELECT 1 FROM stay_pass_pets pp JOIN dogs d ON d.id=pp.dog_id WHERE pp.pass_id=p.id AND (d.customer_id!=p.customer_id OR d.size!=p.size OR d.archived!=0 OR pp.photo_consent!=0))
 AND NOT EXISTS(SELECT 1 FROM json_each(t.snapshot,'$.new_pets') j WHERE NOT EXISTS(SELECT 1 FROM stay_pass_pets WHERE pass_id=p.id AND dog_id=j.value->>'id')))
 OR EXISTS(SELECT 1 FROM stay_pass_credit_transactions WHERE operation_id=NEW.id) THEN RAISE(ABORT,'stay_pass_transfer_mismatch') END;
END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(19,CURRENT_TIMESTAMP);
