-- Rollback for 0015_external_monitor_out_of_band_foundation.
-- Manual-run only (tools/migrate.mjs never auto-applies .rollback.sql).
-- Safe only if no meaningful external-monitor data has accumulated --
-- this is a foundation migration, not a data migration, so that is the
-- expected pre-rollback state (same convention as 0014's own rollback).

BEGIN;

-- D. idempotency_record: restore to its exact pre-0015 (0014) shape.
-- Fails loudly if any idempotency_record row still uses the
-- 'external_monitor_report_submit' scope being removed.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate',
                     'convergence_request_create', 'convergence_execute',
                     'platform_operations_incident_acknowledge',
                     'platform_operations_alert_configuration_update', 'platform_operations_alert_test'))
         = (tenant_id IS NULL));

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
                    'difficulty_override_create',
                    'learning_path_policy_upsert', 'learning_path_policy_delete',
                    'learning_path_alternative_create',
                    'platform_operations_incident_acknowledge', 'platform_operations_alert_configuration_update',
                    'platform_operations_alert_test'));

-- C. operational_incident.backfilled -- fails loudly (nothing to fail on
-- here; DROP COLUMN always succeeds regardless of data, unlike a
-- rollback that would need to reconstruct a removed CHECK/FK). No data
-- loss concern beyond the column's own values, which are meaningless
-- once Level 2 external-monitor reports are rolled back entirely.
ALTER TABLE operational_incident DROP COLUMN IF EXISTS backfilled;

-- B. external_monitor_nonce_seen
DROP INDEX IF EXISTS external_monitor_nonce_seen_seen_at_idx;
DROP TABLE IF EXISTS external_monitor_nonce_seen;

-- A. external_monitor_key_metadata
DROP INDEX IF EXISTS external_monitor_key_metadata_status_idx;
DROP INDEX IF EXISTS external_monitor_key_metadata_single_current_idx;
DROP TABLE IF EXISTS external_monitor_key_metadata;

COMMIT;
