-- Development safeguard until the audited checkout writer is completed.
-- A legacy cash-only checkout must never silently finalize an unreconciled Pass stay.
-- No historical stay, credit or cash row is changed by this migration.
CREATE TRIGGER IF NOT EXISTS stay_pass_checkout_review_lock
 BEFORE UPDATE OF status,actual_checkout_at ON stays
 WHEN EXISTS(SELECT 1 FROM stay_pass_checkin_commits WHERE stay_id=OLD.id)
 AND (NEW.status='completed' OR NEW.actual_checkout_at IS NOT OLD.actual_checkout_at)
 BEGIN SELECT RAISE(ABORT,'stay_pass_checkout_review_required'); END;
INSERT OR IGNORE INTO stay_pass_schema_versions VALUES(10,CURRENT_TIMESTAMP);
