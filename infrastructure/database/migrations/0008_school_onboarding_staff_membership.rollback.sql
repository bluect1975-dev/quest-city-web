-- Reverse of 0008_school_onboarding_staff_membership.sql, in exact
-- opposite order. Rollback requires no pre-existing INVITED/REVOKED
-- staff_tenant_membership rows and no STAFF_GENERAL assignment rows to
-- remain (there cannot be any real ones from before this migration, since
-- those values did not exist as valid until this migration's own forward
-- run) -- the restored, narrower CHECK constraints will fail loudly if
-- any exist, which is the correct, safe behavior rather than silently
-- discarding data.

-- E. staff_account: restore to its exact pre-0008 (0006) shape. Requires
-- no pre-existing SCHOOL_ADMIN-created row to remain (none could exist
-- before this migration's own forward run added that value).
ALTER TABLE staff_account DROP CONSTRAINT IF EXISTS staff_account_created_by_actor_type_check;
ALTER TABLE staff_account ADD CONSTRAINT staff_account_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'ADMIN_BOOTSTRAP_SCRIPT', 'PLATFORM_ADMIN'));

ALTER TABLE staff_account DROP COLUMN IF EXISTS requires_password_setup;

-- D. idempotency_record.scope: restore to its exact pre-0008 (0007) shape.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create'));

-- C. assignment.origin_type: restore to its exact pre-0008 (0004) shape.
ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_origin_type_check;
ALTER TABLE assignment ADD CONSTRAINT assignment_origin_type_check
  CHECK (origin_type IN ('ADMIN_SEED', 'RECOVERY_FROM_REVIEW'));

-- B. staff_invitation: new table, drop entirely.
DROP INDEX IF EXISTS staff_invitation_tenant_idx;
DROP INDEX IF EXISTS staff_invitation_membership_idx;
DROP TABLE IF EXISTS staff_invitation;

-- A. staff_tenant_membership.status: restore to its exact pre-0008 (0004) shape.
ALTER TABLE staff_tenant_membership DROP CONSTRAINT IF EXISTS staff_tenant_membership_status_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED'));
