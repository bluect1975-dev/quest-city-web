-- Reverse of 0010_independent_educator_foundation.sql, in exact opposite
-- order. Requires no pre-existing INDEPENDENT_EDUCATOR tenant, membership,
-- capability_grant or idempotency_record row to remain (none could exist
-- before this migration's own forward run, since those values did not
-- exist as valid until then) -- the restored, narrower CHECK constraints
-- will fail loudly if any exist, which is the correct, safe behavior
-- rather than silently discarding data.

-- D. idempotency_record: restore to its exact pre-0010 (0009) shape.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create',
                    'staff_class_access_code_issue'));

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope = 'platform_tenant_create') = (tenant_id IS NULL));

-- C. capability_grant: restore to its exact pre-0010 (0006) shape.
ALTER TABLE capability_grant DROP CONSTRAINT IF EXISTS capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global'));

-- B. staff_tenant_membership: restore to its exact pre-0010 (0004) shape.
DROP TRIGGER IF EXISTS staff_tenant_membership_role_tenant_type_coherence ON staff_tenant_membership;
DROP FUNCTION IF EXISTS enforce_staff_tenant_membership_role_tenant_type_coherence();

ALTER TABLE staff_tenant_membership DROP CONSTRAINT IF EXISTS staff_tenant_membership_role_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_role_check
  CHECK (role IN ('TEACHER', 'SCHOOL_ADMIN'));

-- A. tenant.type: restore to its exact pre-0010 (0002) shape. Requires no
-- pre-existing INDEPENDENT_EDUCATOR tenant row to remain (none could exist
-- before this migration's own forward run added that value).
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_type_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_type_check
  CHECK (type IN ('SCHOOL', 'ORGANIZATION'));
