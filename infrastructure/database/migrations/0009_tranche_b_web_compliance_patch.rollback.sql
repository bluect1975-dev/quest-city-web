-- Reverse of 0009_tranche_b_web_compliance_patch.sql. Requires no
-- pre-existing 'staff_class_access_code_issue' idempotency_record rows to
-- remain (there cannot be any real ones from before this migration's own
-- forward run, since that scope value did not exist as valid until then)
-- -- the restored, narrower CHECK constraint will fail loudly if any
-- exist, which is the correct, safe behavior rather than silently
-- discarding data.

-- idempotency_record.scope: restore to its exact pre-0009 (0008) shape.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create'));
