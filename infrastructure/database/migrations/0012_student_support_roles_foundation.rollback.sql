-- Reverse of 0012_student_support_roles_foundation.sql, in exact opposite
-- order. Requires no pre-existing ASACOM/SUPPORT_TEACHER membership row
-- and no row in any of the six new tables to remain (none could exist
-- before this migration's own forward run) -- the restored, narrower
-- constraints will fail loudly if any exist, which is the correct, safe
-- behavior rather than silently discarding data.

-- E. idempotency_record: restore to its exact pre-0012 (0011) shape.
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
                    'platform_independent_educator_activate', 'platform_independent_educator_status_update',
                    'convergence_request_create', 'convergence_execute', 'ownership_transfer_promote'));

-- D.2/D.1 minimal facilitation/difficulty persistence tables.
DROP TABLE IF EXISTS difficulty_override;
DROP TABLE IF EXISTS support_profile;

-- C.4-C.1 the four generalized Student Support tables, in reverse
-- dependency order (facilitation_proposal has no FK to the other three;
-- learning_support_observation FKs support_student_assignment;
-- learning_support_event stands alone; support_student_assignment is the
-- root).
DROP TABLE IF EXISTS facilitation_proposal;
DROP TABLE IF EXISTS learning_support_observation;
DROP TABLE IF EXISTS learning_support_event;

DROP TRIGGER IF EXISTS support_student_assignment_support_role_only ON support_student_assignment;
DROP FUNCTION IF EXISTS reject_support_student_assignment_for_non_support_role();
DROP TABLE IF EXISTS support_student_assignment;

-- B. staff_class_assignment: restore the TEACHER-only trigger function
-- to its exact pre-0012 (0004) shape. The trigger itself
-- (staff_class_assignment_teacher_only) was never dropped -- only its
-- function body is replaced here, back to the original.
CREATE OR REPLACE FUNCTION reject_staff_class_assignment_for_non_teacher() RETURNS trigger AS $$
DECLARE
  membership_role TEXT;
BEGIN
  SELECT role INTO membership_role FROM staff_tenant_membership WHERE id = NEW.staff_tenant_membership_id;
  IF membership_role IS DISTINCT FROM 'TEACHER' THEN
    RAISE EXCEPTION 'staff_class_assignment: membership % is role %, expected TEACHER (02_35 §3.2)',
      NEW.staff_tenant_membership_id, membership_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A. staff_tenant_membership: restore to its exact pre-0012 (0010) shape.
-- Requires no pre-existing ASACOM/SUPPORT_TEACHER row and no pre-existing
-- multi-role-same-tenant row pair to remain (neither could exist before
-- this migration's own forward run).
ALTER TABLE staff_tenant_membership
  DROP CONSTRAINT IF EXISTS staff_tenant_membership_staff_account_id_tenant_id_role_key;
ALTER TABLE staff_tenant_membership
  ADD CONSTRAINT staff_tenant_membership_staff_account_id_tenant_id_key
    UNIQUE (staff_account_id, tenant_id);

DROP TRIGGER IF EXISTS staff_tenant_membership_role_tenant_type_coherence ON staff_tenant_membership;
DROP FUNCTION IF EXISTS enforce_staff_tenant_membership_role_tenant_type_coherence();

CREATE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence() RETURNS trigger AS $$
DECLARE
  resolved_tenant_type TEXT;
BEGIN
  SELECT type INTO resolved_tenant_type FROM tenant WHERE id = NEW.tenant_id;
  IF NEW.role = 'INDEPENDENT_EDUCATOR' AND resolved_tenant_type IS DISTINCT FROM 'INDEPENDENT_EDUCATOR' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role INDEPENDENT_EDUCATOR requires tenant.type=INDEPENDENT_EDUCATOR, tenant % has type % (02_25 v1.9 §6.14)',
      NEW.tenant_id, resolved_tenant_type;
  END IF;
  IF NEW.role IN ('TEACHER', 'SCHOOL_ADMIN') AND resolved_tenant_type IS DISTINCT FROM 'SCHOOL' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role % requires tenant.type=SCHOOL, tenant % has type % (02_25 v1.9 §6.14)',
      NEW.role, NEW.tenant_id, resolved_tenant_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_tenant_membership_role_tenant_type_coherence
  BEFORE INSERT OR UPDATE OF role, tenant_id ON staff_tenant_membership
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence();

ALTER TABLE staff_tenant_membership DROP CONSTRAINT IF EXISTS staff_tenant_membership_role_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_role_check
  CHECK (role IN ('TEACHER', 'SCHOOL_ADMIN', 'INDEPENDENT_EDUCATOR'));
