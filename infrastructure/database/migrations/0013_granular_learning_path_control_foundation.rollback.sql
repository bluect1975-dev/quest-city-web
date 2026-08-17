-- Reverse of 0013_granular_learning_path_control_foundation.sql, in exact
-- opposite order. Requires no pre-existing LEARNING_PATH_ADJUSTMENT
-- facilitation_proposal row and no row in any of the three new tables to
-- remain (none could exist before this migration's own forward run) -- the
-- restored, narrower constraints will fail loudly if any exist, which is
-- the correct, safe behavior rather than silently discarding data.

BEGIN;

-- E. idempotency_record: restore to its exact pre-0013 (0012) shape.
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
                    'convergence_request_create', 'convergence_execute', 'ownership_transfer_promote',
                    'support_student_assignment_create', 'learning_support_event_create',
                    'learning_support_observation_create', 'facilitation_proposal_create',
                    'facilitation_proposal_review', 'support_teacher_facilitation_apply',
                    'difficulty_override_create'));

-- D. facilitation_proposal: restore to its exact pre-0013 (0012) shape.
ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_target_alternative_ck;
ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_target_learning_path_ck;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_requested_alternative_content_ref;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_requested_state;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_resource_ref;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_resource_type;

ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_proposal_type_check;
ALTER TABLE facilitation_proposal ADD CONSTRAINT facilitation_proposal_proposal_type_check
  CHECK (proposal_type IN ('FACILITATION', 'DIFFICULTY'));

-- C, B, A: drop the three new tables, in reverse dependency order.
DROP TABLE IF EXISTS learning_path_snapshot;
DROP TABLE IF EXISTS learning_path_alternative;
DROP TABLE IF EXISTS learning_path_policy;

COMMIT;
