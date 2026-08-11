-- Reverse of 0007_platform_tenant_create_idempotency.sql. Requires no
-- pre-existing platform_tenant_create rows to remain (there cannot be
-- any real ones from before this migration, since the scope did not
-- exist as a valid value until this migration's own forward run) --
-- rollback will fail loudly via the restored NOT NULL/CHECK constraints
-- if any exist, which is the correct, safe behavior rather than silently
-- dropping data.

DROP INDEX IF EXISTS idempotency_record_platform_scope_key_idx;

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate'));

ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ALTER COLUMN tenant_id SET NOT NULL;
