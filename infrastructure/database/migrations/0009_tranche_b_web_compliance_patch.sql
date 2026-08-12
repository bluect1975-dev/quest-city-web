-- 0009_tranche_b_web_compliance_patch: School Pilot Readiness Tranche B —
-- Final Web Compliance Patch (canonical quest-city-roblox main
-- 29114e6fbefbf32cde0eaf923e1595536f5cebfc: 02_26 v1.12 §34, 02_25 v1.8
-- §6.11, contracts/quest-city-platform-openapi-v1_10.yaml).
--
-- Single additive change: idempotency_record.scope gains one new value,
-- 'staff_class_access_code_issue', for the new POST /classes/{classId}/
-- access-code mutating write (SchoolClassManagementService.issueAccessCode).
-- No other schema change is required by this patch:
--   - class_access_code (table, unique-active-code-hash index) already
--     exists from migration 0002 and is reused unmodified.
--   - assignment.origin_type / assignment_recovery_target_consistency
--     already support STAFF_GENERAL-scoped discovery (migrations
--     0004/0008), reused unmodified by GET /me/assignments.
--   - school_class / school_enrollment already exist from migration 0002.
-- Same DROP/ADD CONSTRAINT pattern already used by migrations
-- 0004/0006/0007/0008; same table, same generation-based
-- PENDING/COMPLETED/FAILED mechanism, same IdempotencyRecordRepository,
-- unmodified.
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create',
                    'staff_class_access_code_issue'));
