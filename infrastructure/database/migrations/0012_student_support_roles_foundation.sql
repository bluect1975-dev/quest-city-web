-- 0012_student_support_roles_foundation: implements the Student Support
-- Roles (SUPPORT_TEACHER + ASACOM) canonical contract (quest-city-roblox
-- main 6dbbc79346e09a6a3f86c2d8c667d907d0d4b4ad: 02_25 v1.12 §6.16,
-- 02_35 v1.7 §11quinquies/§11sexies, 02_39 v1.2, 02_26 v1.17 §37/§37bis/§38,
-- contracts/quest-city-platform-openapi-v1_13.yaml + v1_14.yaml).
--
-- Six groups of change, each additive, none destroying an existing row or
-- capability (AGENTS.md rule 19):
--
--   A. staff_tenant_membership.role: two new values, ASACOM and
--      SUPPORT_TEACHER (02_25 v1.12 §6.16.1), plus the same tenant/role
--      coherence trigger already introduced by migration 0010, extended
--      to also require tenant.type=SCHOOL for the two new roles.
--      UNIQUE(staff_account_id, tenant_id) relaxed to
--      UNIQUE(staff_account_id, tenant_id, role) (02_25 v1.12 §6.16.6,
--      02_39 v1.1 §3bis.5) -- resolves the same-tenant multi-role scenario
--      (TEACHER + SUPPORT_TEACHER in one tenant) without ever allowing a
--      single row to carry two roles or a second staff_account per human.
--   B. staff_class_assignment: the existing TEACHER-only trigger
--      (migration 0004) is widened to also accept SUPPORT_TEACHER, which
--      reuses staff_class_assignment identically to TEACHER for class
--      scope (02_39 v1.1 §3bis.2, 02_35 v1.7 §11sexies.4) -- no new table.
--   C. Four new tables, generalized from the start (never role-duplicated,
--      02_39 §3 "Do NOT create parallel tables merely because the actor
--      role differs"): support_student_assignment, learning_support_event,
--      learning_support_observation, facilitation_proposal (02_25 v1.12
--      §6.16.2).
--   D. Two new minimal tables, support_profile and difficulty_override,
--      are a DISCOVERED DEPENDENCY, not part of the canonical §6.16 model
--      itself. 02_39 §7.1/§7.2 states FACILITATION/DIFFICULTY authority
--      for SUPPORT_TEACHER/ASACOM is granted by *extending the authority*
--      of the pre-existing support_profile config table (02_31/02_32) and
--      the pre-existing POST /difficulty-overrides mechanism (02_16
--      "Aggiornamento v1.4") -- both explicitly described by their own
--      governing instruction as "TEACHER: existing class-authority model".
--      Verified directly against this repository (grep across
--      infrastructure/database/migrations, packages, apps): neither
--      support_profile/student_support_assignment (02_31/02_32) nor
--      difficulty_override (02_16) has ever been implemented here. Both
--      source documents explicitly and correctly describe themselves as
--      "Deferred Implementation" (02_32 §1: "Il modulo non viene
--      implementato nella baseline iniziale"; feature-flagged via
--      individual_learning_supports.school_tenant_enabled, §9) -- this is
--      not an accidental gap, it is a deliberate prior scope boundary.
--      Building the FULL deferred modules (presets, subject-override UI,
--      review workflow, notifications, the 10-axis D0-D4 calibration
--      engine referenced by 02_16/03_28) is explicitly out of scope of
--      Student Support Roles Web Implementation (adjacent to "Granular
--      Learning Path Control", excluded by the governing instruction).
--      What is created here is the deliberately minimal persistence slice
--      that 02_39's own FACILITATION/DIFFICULTY authority model
--      structurally requires to exist at all for SUPPORT_TEACHER/ASACOM
--      apply/propose operations to be real rather than no-ops: which of
--      the seven 02_31 §4 categories is currently active for a student,
--      at what persistence level (SESSION_ONLY vs PROFILE_LEVEL), and a
--      lightweight motivated/audited difficulty override record. No
--      preset library, no subject-override screen, no calibration, no
--      Teacher-facing D0-D4 dashboard (02_16 TD-24-28) -- those remain
--      unimplemented, unchanged, deferred, exactly as documented.
--   E. idempotency_record: new scopes for every mutating Student Support
--      write (02_26 v1.17 §37.9), reusing the single existing
--      idempotency_record/IdempotencyRecordRepository mechanism.
--   F. No changes to capability_grant (PLATFORM_ADMIN-only mechanism,
--      unrelated -- SUPPORT_TEACHER/ASACOM capability resolution is
--      role-static code in packages/staff-identity, same pattern as
--      TEACHER/SCHOOL_ADMIN/INDEPENDENT_EDUCATOR, not a DB grant table).
--
-- No existing row is affected by any CHECK widening (widening an allowed
-- set can never invalidate a row already inside the narrower set) or by
-- the UNIQUE relaxation (every existing row already satisfies the wider
-- constraint, since it already satisfied the narrower one -- no backfill).

-- A. staff_tenant_membership.role: ASACOM, SUPPORT_TEACHER added.
ALTER TABLE staff_tenant_membership DROP CONSTRAINT staff_tenant_membership_role_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_role_check
  CHECK (role IN ('TEACHER', 'SCHOOL_ADMIN', 'INDEPENDENT_EDUCATOR', 'ASACOM', 'SUPPORT_TEACHER'));

-- Tenant/role coherence (02_25 v1.12 §6.16.1): ASACOM/SUPPORT_TEACHER
-- valid only on tenant.type=SCHOOL, never INDEPENDENT_EDUCATOR. Same
-- function/trigger introduced by migration 0010, replaced here (DROP +
-- CREATE, since CREATE OR REPLACE FUNCTION cannot change a function this
-- trivially reasoned about without risk of leaving stale plan caches --
-- same discipline as migration 0010 itself did not need to consider,
-- since it introduced the trigger for the first time; here we own its
-- full lifecycle explicitly for rollback safety).
DROP TRIGGER staff_tenant_membership_role_tenant_type_coherence ON staff_tenant_membership;
DROP FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence();

CREATE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence() RETURNS trigger AS $$
DECLARE
  resolved_tenant_type TEXT;
BEGIN
  SELECT type INTO resolved_tenant_type FROM tenant WHERE id = NEW.tenant_id;
  IF NEW.role = 'INDEPENDENT_EDUCATOR' AND resolved_tenant_type IS DISTINCT FROM 'INDEPENDENT_EDUCATOR' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role INDEPENDENT_EDUCATOR requires tenant.type=INDEPENDENT_EDUCATOR, tenant % has type % (02_25 v1.9 §6.14)',
      NEW.tenant_id, resolved_tenant_type;
  END IF;
  IF NEW.role IN ('TEACHER', 'SCHOOL_ADMIN', 'SUPPORT_TEACHER', 'ASACOM') AND resolved_tenant_type IS DISTINCT FROM 'SCHOOL' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role % requires tenant.type=SCHOOL, tenant % has type % (02_25 v1.12 §6.16.1)',
      NEW.role, NEW.tenant_id, resolved_tenant_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_tenant_membership_role_tenant_type_coherence
  BEFORE INSERT OR UPDATE OF role, tenant_id ON staff_tenant_membership
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence();

-- Same-tenant multi-role (02_25 v1.12 §6.16.6, 02_39 v1.1 §3bis.5): relax
-- UNIQUE(staff_account_id, tenant_id) to UNIQUE(staff_account_id,
-- tenant_id, role). Default constraint name from the original inline
-- UNIQUE in migration 0004's CREATE TABLE.
ALTER TABLE staff_tenant_membership
  DROP CONSTRAINT staff_tenant_membership_staff_account_id_tenant_id_key;
ALTER TABLE staff_tenant_membership
  ADD CONSTRAINT staff_tenant_membership_staff_account_id_tenant_id_role_key
    UNIQUE (staff_account_id, tenant_id, role);

-- B. staff_class_assignment: widen the TEACHER-only trigger (migration
-- 0004) to also accept SUPPORT_TEACHER (02_39 v1.1 §3bis.2, 02_35 v1.7
-- §11sexies.4 -- identical class-scope mechanism to TEACHER, no new
-- table).
CREATE OR REPLACE FUNCTION reject_staff_class_assignment_for_non_teacher() RETURNS trigger AS $$
DECLARE
  membership_role TEXT;
BEGIN
  SELECT role INTO membership_role FROM staff_tenant_membership WHERE id = NEW.staff_tenant_membership_id;
  IF membership_role NOT IN ('TEACHER', 'SUPPORT_TEACHER') THEN
    RAISE EXCEPTION 'staff_class_assignment: membership % is role %, expected TEACHER or SUPPORT_TEACHER (02_35 v1.7 §11sexies.4)',
      NEW.staff_tenant_membership_id, membership_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- C.1 support_student_assignment (renamed/generalized from the
-- never-migrated v1.0 asacom_student_assignment -- no data migration cost,
-- the table never physically existed, 02_25 v1.12 §6.16.5).
CREATE TABLE support_student_assignment (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                   TEXT NOT NULL UNIQUE,
  tenant_id                   UUID NOT NULL REFERENCES tenant (id),
  staff_tenant_membership_id  UUID NOT NULL,
  student_profile_id          UUID NOT NULL,
  class_id                    UUID,
  status                      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'REVOKED')),
  starts_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at                     TIMESTAMPTZ,
  assigned_by_staff_account_id UUID NOT NULL REFERENCES staff_account (id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                  TIMESTAMPTZ,
  revoked_by_staff_account_id UUID REFERENCES staff_account (id),
  FOREIGN KEY (staff_tenant_membership_id, tenant_id) REFERENCES staff_tenant_membership (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  UNIQUE (id, tenant_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by_staff_account_id IS NOT NULL))
);

-- CHECK applicativo (Postgres non esprime un cross-table CHECK
-- direttamente, 02_25 §6.11): la membership referenziata deve avere
-- role IN (ASACOM, SUPPORT_TEACHER) -- stesso principio di trigger già
-- usato da staff_class_assignment.
CREATE FUNCTION reject_support_student_assignment_for_non_support_role() RETURNS trigger AS $$
DECLARE
  membership_role TEXT;
BEGIN
  SELECT role INTO membership_role FROM staff_tenant_membership WHERE id = NEW.staff_tenant_membership_id;
  IF membership_role NOT IN ('ASACOM', 'SUPPORT_TEACHER') THEN
    RAISE EXCEPTION 'support_student_assignment: membership % is role %, expected ASACOM or SUPPORT_TEACHER (02_25 v1.12 §6.16.2)',
      NEW.staff_tenant_membership_id, membership_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER support_student_assignment_support_role_only
  BEFORE INSERT ON support_student_assignment
  FOR EACH ROW EXECUTE FUNCTION reject_support_student_assignment_for_non_support_role();

-- Anti-duplication: no two concurrent ACTIVE assignments for the same
-- (membership, student) pair (02_25 v1.12 §6.16.2).
CREATE UNIQUE INDEX support_student_assignment_active_uq
  ON support_student_assignment (staff_tenant_membership_id, student_profile_id) WHERE status = 'ACTIVE';

-- C.2 learning_support_event -- HUMAN_SUPPORT axis, append-only.
CREATE TABLE learning_support_event (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id              TEXT NOT NULL UNIQUE,
  tenant_id              UUID NOT NULL REFERENCES tenant (id),
  learning_attempt_id    UUID NOT NULL,
  student_profile_id     UUID NOT NULL,
  actor_staff_account_id UUID NOT NULL REFERENCES staff_account (id),
  actor_role             TEXT NOT NULL CHECK (actor_role IN ('ASACOM', 'TEACHER', 'SUPPORT_TEACHER')),
  support_type           TEXT NOT NULL CHECK (support_type IN
                            ('COMMUNICATION_SUPPORT', 'COMPREHENSION_SUPPORT', 'ATTENTION_SUPPORT',
                             'MOTOR_INTERACTION_SUPPORT', 'NAVIGATION_SUPPORT', 'EMOTIONAL_REGULATION_SUPPORT',
                             'TASK_ORGANIZATION_SUPPORT', 'ACCESSIBILITY_FACILITATION', 'OTHER_STRUCTURED')),
  intensity               TEXT NOT NULL CHECK (intensity IN ('NONE', 'MINIMAL', 'MODERATE', 'SIGNIFICANT')),
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds        INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  note_structured_ref     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (learning_attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (id, tenant_id)
  -- Append-only by convention (02_39 §9): no UPDATE/DELETE route is ever
  -- implemented against this table -- corrections are a new row, same
  -- discipline as migration_plan/learning_support_observation.
);

-- C.3 learning_support_observation -- post-session, append-only with
-- explicit supersession (never a destructive edit).
CREATE TABLE learning_support_observation (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                       TEXT NOT NULL UNIQUE,
  tenant_id                       UUID NOT NULL REFERENCES tenant (id),
  student_profile_id              UUID NOT NULL,
  support_student_assignment_id   UUID NOT NULL,
  actor_staff_account_id          UUID NOT NULL REFERENCES staff_account (id),
  actor_role                      TEXT NOT NULL CHECK (actor_role IN ('ASACOM', 'SUPPORT_TEACHER')),
  observed_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  category                        TEXT CHECK (category IS NULL OR category IN
                                     ('COMMUNICATION_SUPPORT', 'COMPREHENSION_SUPPORT', 'ATTENTION_SUPPORT',
                                      'MOTOR_INTERACTION_SUPPORT', 'NAVIGATION_SUPPORT', 'EMOTIONAL_REGULATION_SUPPORT',
                                      'TASK_ORGANIZATION_SUPPORT', 'ACCESSIBILITY_FACILITATION', 'OTHER_STRUCTURED')),
  note_structured_ref             TEXT,
  superseded_by_id                UUID,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (support_student_assignment_id, tenant_id) REFERENCES support_student_assignment (id, tenant_id),
  FOREIGN KEY (superseded_by_id, tenant_id) REFERENCES learning_support_observation (id, tenant_id),
  UNIQUE (id, tenant_id)
);

-- C.4 facilitation_proposal -- FACILITATION/DIFFICULTY proposal workflow,
-- one shared model for both proposal_type values (02_39 §11).
CREATE TABLE facilitation_proposal (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                   TEXT NOT NULL UNIQUE,
  tenant_id                   UUID NOT NULL REFERENCES tenant (id),
  student_profile_id          UUID NOT NULL,
  proposed_by_staff_account_id UUID NOT NULL REFERENCES staff_account (id),
  proposal_type                TEXT NOT NULL CHECK (proposal_type IN ('FACILITATION', 'DIFFICULTY')),
  target_category               TEXT,
  description_structured_ref    TEXT,
  status                         TEXT NOT NULL DEFAULT 'SUBMITTED'
                                    CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  reviewed_by_staff_account_id  UUID REFERENCES staff_account (id),
  reviewed_at                    TIMESTAMPTZ,
  review_note                    TEXT,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  version                        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (id, tenant_id),
  -- Anti-self-approval (02_25 v1.12 §6.16.2, 02_39 §6ter) -- enforced at
  -- the schema level, not only in application code.
  CHECK (reviewed_by_staff_account_id IS DISTINCT FROM proposed_by_staff_account_id),
  CHECK ((status IN ('ACCEPTED', 'REJECTED')) = (reviewed_by_staff_account_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

-- D.1 support_profile -- minimal FACILITATION persistence slice (see
-- header note D above). Deliberately NOT the full 02_31/02_32 deferred
-- module: no preset library, no subject-override screen, no review
-- workflow, no notifications, no feature flag.
CREATE TABLE support_profile (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID NOT NULL REFERENCES tenant (id),
  student_profile_id           UUID NOT NULL,
  category                     TEXT NOT NULL CHECK (category IN
                                  ('PRESENTATION', 'TIME_AND_LOAD', 'TOOLS', 'RESPONSE',
                                   'FEEDBACK', 'ASSESSMENT', 'SUBJECT')),
  level                        TEXT NOT NULL CHECK (level IN ('SESSION_ONLY', 'PROFILE_LEVEL')),
  config_json                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  applied_by_staff_account_id  UUID NOT NULL REFERENCES staff_account (id),
  applied_by_role              TEXT NOT NULL CHECK (applied_by_role IN ('TEACHER', 'SUPPORT_TEACHER', 'ASACOM')),
  expires_at                   TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (id, tenant_id),
  -- SESSION_ONLY rows are always time-bounded (never persist past a
  -- short window, 02_39 §7.3); PROFILE_LEVEL rows never expire on their
  -- own (persistent until explicitly revoked).
  CHECK ((level = 'SESSION_ONLY') = (expires_at IS NOT NULL)),
  -- ASACOM never writes PROFILE_LEVEL (02_39 §7.1) -- enforced again at
  -- the application layer, mirrored here as a defense-in-depth CHECK.
  CHECK (NOT (applied_by_role = 'ASACOM' AND level = 'PROFILE_LEVEL'))
);

CREATE UNIQUE INDEX support_profile_active_category_uq
  ON support_profile (student_profile_id, category) WHERE status = 'ACTIVE' AND level = 'PROFILE_LEVEL';

-- D.2 difficulty_override -- minimal DIFFICULTY persistence slice (see
-- header note D above). Deliberately NOT the full 02_16/03_28 D0-D4
-- multidimensional calibration engine.
CREATE TABLE difficulty_override (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID NOT NULL REFERENCES tenant (id),
  class_id                     UUID,
  student_profile_id           UUID,
  target_ref                   TEXT NOT NULL,
  reason                       TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by_staff_account_id  UUID NOT NULL REFERENCES staff_account (id),
  created_by_role               TEXT NOT NULL CHECK (created_by_role IN ('TEACHER', 'SUPPORT_TEACHER')),
  status                        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                    TIMESTAMPTZ,
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (id, tenant_id),
  -- Exactly one scope: class-wide (TEACHER, out of this task's UI scope
  -- but modeled so SUPPORT_TEACHER's per-student mechanism has something
  -- real to "reuse") xor per-student (SUPPORT_TEACHER, §7.2).
  CHECK ((class_id IS NOT NULL) <> (student_profile_id IS NOT NULL)),
  CHECK ((created_by_role = 'SUPPORT_TEACHER') = (student_profile_id IS NOT NULL)),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- E. idempotency_record: new scopes for Student Support writes (02_26
-- v1.17 §37.9). Table/mechanism reused unmodified.
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
                    'difficulty_override_create'));
-- support_student_assignment_create/difficulty_override_create etc. are
-- all tenant-scoped as usual (SCHOOL_ADMIN/TEACHER/SUPPORT_TEACHER acting
-- on their own tenant) -- none added to the tenant_id-NULL set.

CREATE INDEX support_student_assignment_membership_idx ON support_student_assignment (staff_tenant_membership_id);
CREATE INDEX support_student_assignment_student_idx ON support_student_assignment (tenant_id, student_profile_id);
CREATE INDEX learning_support_event_attempt_idx ON learning_support_event (learning_attempt_id);
CREATE INDEX learning_support_event_student_idx ON learning_support_event (tenant_id, student_profile_id, occurred_at);
CREATE INDEX learning_support_observation_student_idx ON learning_support_observation (tenant_id, student_profile_id, observed_at);
CREATE INDEX learning_support_observation_assignment_idx ON learning_support_observation (support_student_assignment_id);
CREATE INDEX facilitation_proposal_student_idx ON facilitation_proposal (tenant_id, student_profile_id);
CREATE INDEX facilitation_proposal_status_idx ON facilitation_proposal (tenant_id, status, created_at);
CREATE INDEX support_profile_student_idx ON support_profile (tenant_id, student_profile_id);
CREATE INDEX difficulty_override_class_idx ON difficulty_override (tenant_id, class_id) WHERE class_id IS NOT NULL;
CREATE INDEX difficulty_override_student_idx ON difficulty_override (tenant_id, student_profile_id) WHERE student_profile_id IS NOT NULL;
