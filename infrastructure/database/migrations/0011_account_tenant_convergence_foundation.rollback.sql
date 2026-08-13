-- Reverse of 0011_account_tenant_convergence_foundation.sql, in exact
-- opposite order.

-- F. Restore the composite FK chain to NOT DEFERRABLE (its exact pre-0011
-- shape). ALTER CONSTRAINT with no DEFERRABLE clause is not supported
-- directly by Postgres for switching back to NOT DEFERRABLE via ALTER
-- CONSTRAINT alone in all versions; recreate explicitly instead.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND condeferrable = true
      AND conrelid IN (
        'school_enrollment'::regclass, 'class_access_code'::regclass, 'assignment'::regclass,
        'assignment_runtime_channel'::regclass, 'staff_class_assignment'::regclass, 'learning_attempt'::regclass
      )
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I NOT DEFERRABLE', r.tbl, r.conname);
  END LOOP;
END $$;

-- E. capability_grant: restore to its exact pre-0011 (0010) shape.
-- Requires no pre-existing convergence.preview/.execute/.rollback.review
-- capability_grant row to remain.
ALTER TABLE capability_grant DROP CONSTRAINT IF EXISTS capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global',
     'independent_educator.activate', 'independent_educator.read', 'independent_educator.status.manage'));

-- D. idempotency_record: restore to its exact pre-0011 (0010) shape.
-- Requires no pre-existing convergence_request_create/convergence_execute/
-- ownership_transfer_promote idempotency_record row to remain.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create',
                    'staff_class_access_code_issue',
                    'platform_independent_educator_activate', 'platform_independent_educator_status_update'));

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate')) = (tenant_id IS NULL));

-- C. migration_execution.
ALTER TABLE convergence_request DROP CONSTRAINT IF EXISTS convergence_request_current_migration_execution_fkey;
DROP TABLE IF EXISTS migration_execution;

-- B. migration_plan.
DROP TRIGGER IF EXISTS migration_plan_append_only ON migration_plan;
DROP FUNCTION IF EXISTS reject_migration_plan_update();
ALTER TABLE convergence_request DROP CONSTRAINT IF EXISTS convergence_request_current_migration_plan_fkey;
DROP TABLE IF EXISTS migration_plan;

-- A. convergence_request.
DROP TRIGGER IF EXISTS convergence_request_tenant_types_coherence ON convergence_request;
DROP FUNCTION IF EXISTS enforce_convergence_request_tenant_types();
DROP TABLE IF EXISTS convergence_request;
