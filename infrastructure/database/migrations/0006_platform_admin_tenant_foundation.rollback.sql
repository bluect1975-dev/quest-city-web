-- Reverse order of 0006_platform_admin_tenant_foundation.sql, respecting
-- foreign key dependency order. Restores idempotency_record.scope and
-- staff_account.created_by_actor_type to their exact migration-0004
-- shape. No pre-existing data is touched: every object dropped here was
-- created by the forward migration.

DROP INDEX IF EXISTS tenant_status_idx;
DROP INDEX IF EXISTS platform_admin_session_account_idx;
DROP INDEX IF EXISTS capability_grant_grant_idx;
DROP INDEX IF EXISTS platform_admin_grant_status_idx;

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create'));

DROP TABLE IF EXISTS platform_admin_session;
DROP TABLE IF EXISTS capability_grant;
DROP TABLE IF EXISTS platform_admin_grant;

ALTER TABLE staff_account DROP CONSTRAINT IF EXISTS staff_account_created_by_actor_type_check;
ALTER TABLE staff_account ADD CONSTRAINT staff_account_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT'));
