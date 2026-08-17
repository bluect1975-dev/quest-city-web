-- 0013_granular_learning_path_control_foundation: implements the Granular
-- Learning Path Control (GLPC) canonical contract (quest-city-roblox main
-- 6e361d4: 02_41 v1.1, 02_26 v1.19 §21, contracts/quest-city-platform-openapi-v1_15.yaml).
--
-- Three new tables, all additive, none destroying an existing row or
-- capability (AGENTS.md rule 19):
--
--   A. learning_path_policy -- the single unified scoped-policy model
--      (02_41 §42). One table for PLATFORM/SCHOOL/CLASS/STUDENT scope,
--      never a table-per-scope (02_41 §28). scope_ref is nullable and
--      interpreted per scope (class_id for CLASS, student_profile_id for
--      STUDENT, unused for PLATFORM/SCHOOL).
--
--   B. learning_path_alternative -- ORIGINAL_CONTENT -> ALTERNATIVE_CONTENT
--      replacement mapping (02_41 §27, §42). Never mutates the original.
--
--   C. learning_path_snapshot -- immutable capture of the resolved
--      effective path at learning_attempt start (02_41 §33, §42). One row
--      per attempt; FK to the existing learning_attempt table, no second
--      attempt lifecycle introduced.
--
--   D. facilitation_proposal extended additively: proposal_type CHECK
--      gains LEARNING_PATH_ADJUSTMENT (02_41 §23), and four nullable
--      columns carry the TargetLearningPath payload (resourceType,
--      resourceRef, requestedState, requestedAlternativeContentRef) --
--      reuses the existing proposal/review/anti-self-approval/atomicity
--      machinery verbatim, no second proposal table (02_39 §3 discipline).
--
--   E. idempotency_record: three new scopes for the GLPC write operations
--      that carry an IdempotencyKey parameter (OpenAPI v1.15.0
--      createOrUpdateLearningPathPolicy, deleteLearningPathPolicy,
--      createLearningPathAlternative). Table/mechanism reused unmodified
--      (mission §41: no second idempotency mechanism).
--
-- DISCOVERED IMPLEMENTATION NOTE (not a canonical contract deviation):
-- 02_25's conceptual curriculum_profile/class_curriculum_module/
-- content_entity_index tables (§6.4-6.5) were never actually migrated into
-- quest-city-web -- verified directly against every existing migration
-- file before writing this one (grep across infrastructure/database/migrations/
-- returns zero hits for any of these table names). 02_41 §43 itself only
-- requires resource_ref to reuse the content_entity_index *pattern*
-- (opaque entity_type/entity_id identity), not a live FK -- the OpenAPI
-- v1.15.0 contract already declares resourceRef as a plain string with no
-- format constraint. resource_type/resource_ref are therefore implemented
-- here as a CHECK-constrained enum plus an opaque TEXT column, never a
-- foreign key to a table that does not exist -- consistent with, not a
-- deviation from, the canonical contract.

BEGIN;

-- A. learning_path_policy
CREATE TABLE learning_path_policy (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                       TEXT NOT NULL UNIQUE,
  tenant_id                       UUID NOT NULL REFERENCES tenant (id),
  scope                           TEXT NOT NULL CHECK (scope IN ('PLATFORM', 'SCHOOL', 'CLASS', 'STUDENT')),
  scope_class_id                  UUID,
  scope_student_profile_id        UUID,
  resource_type                   TEXT NOT NULL CHECK (resource_type IN
                                     ('SUBJECT', 'TRACK', 'YEAR', 'MODULE', 'UNIT', 'UNIT_ELEMENT')),
  resource_ref                    TEXT NOT NULL CHECK (length(trim(resource_ref)) > 0),
  state                           TEXT NOT NULL CHECK (state IN
                                     ('ENABLED', 'DISABLED', 'DISABLED_AND_WAIVED',
                                      'DISABLED_WITH_ALTERNATIVE', 'UNAVAILABLE_FOR_USE')),
  -- INHERIT (02_41 §9) is represented by the ABSENCE of a row, never a
  -- persisted state value -- a row here is always an explicit override.
  reason_category                 TEXT NOT NULL CHECK (reason_category IN
                                     ('PEDAGOGICAL', 'ACCESSIBILITY', 'TEMPORARY_SUPPORT',
                                      'ALTERNATIVE_ACTIVITY', 'CURRICULUM_SCHEDULING',
                                      'SCHOOL_POLICY', 'TEACHER_DECISION', 'OTHER_STRUCTURED')),
  reason_notes                    TEXT,
  alternative_content_ref         TEXT,
  deployment_year                 TEXT,
  created_by_staff_account_id     UUID NOT NULL REFERENCES staff_account (id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version                         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (scope_class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  FOREIGN KEY (scope_student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (id, tenant_id),
  -- Exactly one scope-ref column populated per scope value (02_41 §42) --
  -- PLATFORM/SCHOOL carry neither, CLASS carries only scope_class_id,
  -- STUDENT carries only scope_student_profile_id.
  CHECK (
    CASE scope
      WHEN 'PLATFORM' THEN scope_class_id IS NULL AND scope_student_profile_id IS NULL
      WHEN 'SCHOOL'   THEN scope_class_id IS NULL AND scope_student_profile_id IS NULL
      WHEN 'CLASS'    THEN scope_class_id IS NOT NULL AND scope_student_profile_id IS NULL
      WHEN 'STUDENT'  THEN scope_class_id IS NULL AND scope_student_profile_id IS NOT NULL
      ELSE FALSE
    END
  ),
  -- UNAVAILABLE_FOR_USE is a PLATFORM-only hard lock (02_41 §15).
  CHECK (state != 'UNAVAILABLE_FOR_USE' OR scope = 'PLATFORM'),
  -- alternative_content_ref is required exactly when state demands one.
  CHECK ((state = 'DISABLED_WITH_ALTERNATIVE') = (alternative_content_ref IS NOT NULL))
);

-- One explicit policy per (tenant, scope, scope-ref, resource) -- a second
-- POST upserts rather than duplicating (02_41 §42, OpenAPI v1.15.0
-- createOrUpdateLearningPathPolicy). COALESCE folds the two nullable
-- scope-ref columns into the unique key without a partial-index-per-scope
-- proliferation.
CREATE UNIQUE INDEX learning_path_policy_scope_resource_uq
  ON learning_path_policy (
    tenant_id, scope,
    COALESCE(scope_class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_student_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    resource_type, resource_ref
  );

CREATE INDEX learning_path_policy_resource_idx
  ON learning_path_policy (tenant_id, resource_type, resource_ref);
CREATE INDEX learning_path_policy_class_idx
  ON learning_path_policy (tenant_id, scope_class_id) WHERE scope_class_id IS NOT NULL;
CREATE INDEX learning_path_policy_student_idx
  ON learning_path_policy (tenant_id, scope_student_profile_id) WHERE scope_student_profile_id IS NOT NULL;

-- B. learning_path_alternative
CREATE TABLE learning_path_alternative (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                    TEXT NOT NULL UNIQUE,
  tenant_id                    UUID NOT NULL REFERENCES tenant (id),
  original_resource_type       TEXT NOT NULL CHECK (original_resource_type IN
                                  ('SUBJECT', 'TRACK', 'YEAR', 'MODULE', 'UNIT', 'UNIT_ELEMENT')),
  original_resource_ref        TEXT NOT NULL CHECK (length(trim(original_resource_ref)) > 0),
  alternative_content_ref      TEXT NOT NULL CHECK (length(trim(alternative_content_ref)) > 0),
  created_by_staff_account_id  UUID NOT NULL REFERENCES staff_account (id),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE INDEX learning_path_alternative_original_idx
  ON learning_path_alternative (tenant_id, original_resource_type, original_resource_ref);

-- C. learning_path_snapshot -- captured once at learning_attempt start,
-- never mutated afterward (02_41 §33-34, immutability discipline already
-- applied to interactive_experience_version/curriculum_profile).
CREATE TABLE learning_path_snapshot (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenant (id),
  learning_attempt_id    UUID NOT NULL,
  resolved_availability  JSONB NOT NULL,
  captured_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (learning_attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  UNIQUE (id, tenant_id),
  -- One snapshot per attempt -- captured exactly once at CREATED, never
  -- replaced (02_41 §23 finish-current-attempt: the attempt always
  -- resolves against its own first snapshot).
  UNIQUE (learning_attempt_id)
);

-- D. facilitation_proposal extended additively for LEARNING_PATH_ADJUSTMENT
ALTER TABLE facilitation_proposal DROP CONSTRAINT facilitation_proposal_proposal_type_check;
ALTER TABLE facilitation_proposal ADD CONSTRAINT facilitation_proposal_proposal_type_check
  CHECK (proposal_type IN ('FACILITATION', 'DIFFICULTY', 'LEARNING_PATH_ADJUSTMENT'));

ALTER TABLE facilitation_proposal ADD COLUMN target_resource_type TEXT
  CHECK (target_resource_type IS NULL OR target_resource_type IN
    ('SUBJECT', 'TRACK', 'YEAR', 'MODULE', 'UNIT', 'UNIT_ELEMENT'));
ALTER TABLE facilitation_proposal ADD COLUMN target_resource_ref TEXT;
ALTER TABLE facilitation_proposal ADD COLUMN target_requested_state TEXT
  CHECK (target_requested_state IS NULL OR target_requested_state IN
    ('ENABLED', 'DISABLED', 'DISABLED_AND_WAIVED', 'DISABLED_WITH_ALTERNATIVE'));
ALTER TABLE facilitation_proposal ADD COLUMN target_requested_alternative_content_ref TEXT;

-- The four target_* columns are populated together, and exactly when
-- proposal_type = LEARNING_PATH_ADJUSTMENT (02_41 §23, OpenAPI v1.15.0
-- TargetLearningPath) -- never for FACILITATION/DIFFICULTY, which continue
-- to use the pre-existing target_category/description_structured_ref pair
-- unchanged.
ALTER TABLE facilitation_proposal ADD CONSTRAINT facilitation_proposal_target_learning_path_ck
  CHECK (
    (proposal_type = 'LEARNING_PATH_ADJUSTMENT') = (
      target_resource_type IS NOT NULL
      AND target_resource_ref IS NOT NULL
      AND target_requested_state IS NOT NULL
    )
  );
ALTER TABLE facilitation_proposal ADD CONSTRAINT facilitation_proposal_target_alternative_ck
  CHECK ((target_requested_state = 'DISABLED_WITH_ALTERNATIVE') = (target_requested_alternative_content_ref IS NOT NULL));

-- E. idempotency_record: extend with the 3 GLPC write scopes.
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
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

COMMIT;
