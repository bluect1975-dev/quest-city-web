-- Rollback for 0014_master_admin_operations_control_center_foundation.
-- Manual-run only (tools/migrate.mjs never auto-applies .rollback.sql).
-- Safe only if no meaningful operational data has accumulated in the
-- seven new tables -- this is a foundation migration, not a data
-- migration, so that is the expected pre-rollback state.

BEGIN;

-- I. capability_grant: restore to its exact pre-0014 (0011) shape.
-- Fails loudly (FK/CHECK violation) if any capability_grant row still
-- references one of the nine operations.* capabilities being removed --
-- intentional: a rollback must not silently orphan a live grant.
ALTER TABLE capability_grant DROP CONSTRAINT IF EXISTS capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global',
     'independent_educator.activate', 'independent_educator.read', 'independent_educator.status.manage',
     'convergence.read', 'convergence.preview', 'convergence.execute', 'convergence.rollback.review'));

-- H. idempotency_record: restore to its exact pre-0014 (0013) shape --
-- every scope introduced by migrations 0004-0013, not just 0007's
-- original eight (a rollback that only restored 0007's shape would
-- itself reintroduce the exact same "silently drops scopes 0008-0013
-- added" defect this migration's own forward direction was fixed for).
-- Fails loudly if any idempotency_record row still uses one of the three
-- new tenant-less scopes.
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate',
                     'convergence_request_create', 'convergence_execute'))
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
                    'learning_path_alternative_create'));

-- G-A. Drop the seven new tables (reverse dependency order).
DROP INDEX IF EXISTS user_presence_tenant_last_seen_idx;
DROP TABLE IF EXISTS user_presence;

DROP INDEX IF EXISTS alert_delivery_status_idx;
DROP INDEX IF EXISTS alert_delivery_incident_idx;
DROP TABLE IF EXISTS alert_delivery;

DROP TABLE IF EXISTS alert_configuration;

DROP INDEX IF EXISTS operational_incident_event_incident_time_idx;
DROP TABLE IF EXISTS operational_incident_event;

DROP INDEX IF EXISTS operational_incident_status_severity_idx;
DROP INDEX IF EXISTS operational_incident_open_dedup_key_idx;
DROP TABLE IF EXISTS operational_incident;

DROP INDEX IF EXISTS service_health_state_service_time_idx;
DROP TABLE IF EXISTS service_health_state;

DROP INDEX IF EXISTS operational_metric_sample_source_key_time_idx;
DROP TABLE IF EXISTS operational_metric_sample;

COMMIT;
