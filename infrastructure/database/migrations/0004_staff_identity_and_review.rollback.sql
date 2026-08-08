-- Reverse order of 0004_staff_identity_and_review.sql, respecting foreign
-- key dependency order. Restores idempotency_record.scope and assignment
-- to their exact migration-0003 shape.

DROP INDEX IF EXISTS teacher_feedback_attempt_idx;
DROP INDEX IF EXISTS teacher_feedback_tenant_student_idx;
DROP INDEX IF EXISTS review_queue_item_tenant_class_status_idx;
DROP INDEX IF EXISTS staff_session_account_idx;
DROP INDEX IF EXISTS staff_class_assignment_membership_idx;
DROP INDEX IF EXISTS staff_tenant_membership_account_idx;

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion'));

ALTER TABLE teacher_feedback DROP CONSTRAINT IF EXISTS teacher_feedback_recovery_assignment_fk;

ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_created_by_actor_type_check;
ALTER TABLE assignment ADD CONSTRAINT assignment_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'SYSTEM'));

ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_recovery_target_consistency;
ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_target_student_profile_fk;
ALTER TABLE assignment DROP COLUMN IF EXISTS target_student_profile_id;
ALTER TABLE assignment DROP COLUMN IF EXISTS origin_type;

DROP TABLE IF EXISTS teacher_feedback;

DROP INDEX IF EXISTS review_queue_item_attempt_active_uq;
DROP TABLE IF EXISTS review_queue_item;

DROP TABLE IF EXISTS staff_session;

DROP TRIGGER IF EXISTS staff_class_assignment_teacher_only ON staff_class_assignment;
DROP FUNCTION IF EXISTS reject_staff_class_assignment_for_non_teacher();
DROP TABLE IF EXISTS staff_class_assignment;

DROP TABLE IF EXISTS staff_tenant_membership;

DROP TABLE IF EXISTS staff_account;
