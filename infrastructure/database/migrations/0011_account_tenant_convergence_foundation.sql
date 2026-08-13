-- 0011_account_tenant_convergence_foundation: implements the School Pilot
-- Readiness Tranche D canonical contract (quest-city-roblox main
-- f541061112a84b689e5a87be0a2aa17a5f108ff1: 02_25 v1.10 §6.15, 02_35 v1.5
-- §11quater, 02_26 v1.14 §36, 02_38 v1.4 §9-10/§10.2bis/§12-15/§17-18/
-- §20-22, contracts/quest-city-platform-openapi-v1_12.yaml).
--
-- Six independent, additive changes, each reusing an existing mechanism
-- unmodified rather than introducing a new one:
--   A. convergence_request: new table. Deliberately has NO single
--      tenant_id column (02_25 v1.10 §6.15.0) -- it relates a
--      source_tenant (INDEPENDENT_EDUCATOR) and a target_tenant (SCHOOL)
--      by construction; isolation is applied at the query layer (two
--      explicit scoped reads), never a single unscoped read.
--   B. migration_plan: new table, append-only (never UPDATEd after
--      INSERT by application code -- enforced by trigger below).
--   C. migration_execution: new table.
--   D. idempotency_record: three new scopes, two of them (create,
--      execute) joining the existing tenant_id-NULL set for the same
--      reason as platform_tenant_create/platform_independent_educator_activate
--      (0007/0010) -- no single natural tenant_id at request time.
--   E. capability_grant: four new PLATFORM_ADMIN-only capabilities
--      (convergence.read, convergence.preview, convergence.execute,
--      convergence.rollback.review).
--      convergence.request/.read/.approve.teacher/.approve.school and
--      ownership.transfer.approve are NOT capability_grant rows -- they
--      are role-derived (INDEPENDENT_EDUCATOR/SCHOOL_ADMIN), same
--      mechanism as class.create/roster.manage (packages/staff-identity
--      capability.ts), no schema change needed for those.
--   F. Cross-tenant class migration support: the composite foreign keys
--      that chain school_class -> school_enrollment/class_access_code/
--      assignment/learning_attempt/staff_class_assignment (and
--      student_profile -> school_enrollment/learning_attempt) are marked
--      DEFERRABLE INITIALLY DEFERRED. This does not change behavior for
--      any existing write path (deferred checking only takes effect
--      inside a transaction that explicitly runs `SET CONSTRAINTS ALL
--      DEFERRED`) -- it is required because migrating a class from an
--      INDEPENDENT_EDUCATOR tenant to a SCHOOL tenant means updating
--      tenant_id on a whole composite-FK chain of rows, and with
--      immediate (non-deferred) checking no single-statement order
--      exists that keeps every intermediate statement consistent.

-- A. convergence_request.
CREATE TABLE convergence_request (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                           TEXT NOT NULL UNIQUE,
  source_tenant_id                    UUID NOT NULL REFERENCES tenant (id),
  target_tenant_id                    UUID NOT NULL REFERENCES tenant (id),
  educator_staff_account_id           UUID NOT NULL REFERENCES staff_account (id),
  requested_by_staff_account_id       UUID NOT NULL REFERENCES staff_account (id),
  status                              TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN
                                         ('REQUESTED', 'PREVIEW_READY', 'AWAITING_APPROVALS', 'APPROVED',
                                          'READY_TO_EXECUTE', 'EXECUTING', 'COMPLETED', 'REJECTED', 'BLOCKED',
                                          'FAILED', 'ROLLBACK_REVIEW_REQUIRED')),
  teacher_confirmed_at                TIMESTAMPTZ,
  school_approved_at                  TIMESTAMPTZ,
  school_approved_by_staff_account_id UUID REFERENCES staff_account (id),
  platform_identity_verified_at       TIMESTAMPTZ,
  platform_identity_verified_by       UUID REFERENCES staff_account (id),
  current_migration_plan_id           UUID,
  current_migration_execution_id      UUID,
  rejected_at                         TIMESTAMPTZ,
  rejected_by_staff_account_id        UUID REFERENCES staff_account (id),
  rejection_reason                    TEXT,
  failure_code                        TEXT,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_tenant_id <> target_tenant_id)
);

-- Anti-duplication (02_25 v1.10 §6.15, 02_26 v1.14 §36.2): at most one
-- non-terminal request per (source, target, educator) triple. Same partial
-- unique index technique already used by idempotency_record (0007).
CREATE UNIQUE INDEX convergence_request_active_uq
  ON convergence_request (source_tenant_id, target_tenant_id, educator_staff_account_id)
  WHERE status NOT IN ('REJECTED', 'BLOCKED', 'COMPLETED');

CREATE INDEX convergence_request_source_tenant_idx ON convergence_request (source_tenant_id);
CREATE INDEX convergence_request_target_tenant_idx ON convergence_request (target_tenant_id);

-- Tenant-type coherence (02_38 v1.4 §9-10): enforced server-side via
-- trigger, never a cross-table CHECK -- same discipline as migration
-- 0010's enforce_staff_tenant_membership_role_tenant_type_coherence.
CREATE FUNCTION enforce_convergence_request_tenant_types() RETURNS trigger AS $$
DECLARE
  source_type TEXT;
  target_type TEXT;
BEGIN
  SELECT type INTO source_type FROM tenant WHERE id = NEW.source_tenant_id;
  SELECT type INTO target_type FROM tenant WHERE id = NEW.target_tenant_id;
  IF source_type IS DISTINCT FROM 'INDEPENDENT_EDUCATOR' THEN
    RAISE EXCEPTION 'convergence_request: source_tenant_id % has type %, expected INDEPENDENT_EDUCATOR (02_38 v1.4 §9)',
      NEW.source_tenant_id, source_type;
  END IF;
  IF target_type IS DISTINCT FROM 'SCHOOL' THEN
    RAISE EXCEPTION 'convergence_request: target_tenant_id % has type %, expected SCHOOL (02_38 v1.4 §9)',
      NEW.target_tenant_id, target_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER convergence_request_tenant_types_coherence
  BEFORE INSERT OR UPDATE OF source_tenant_id, target_tenant_id ON convergence_request
  FOR EACH ROW EXECUTE FUNCTION enforce_convergence_request_tenant_types();

-- B. migration_plan (append-only -- 02_25 v1.10 §6.15).
CREATE TABLE migration_plan (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convergence_request_id      UUID NOT NULL REFERENCES convergence_request (id),
  fingerprint                 TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'STALE')),
  classes_considered_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  class_decisions_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  students_affected_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts_json              JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignments_affected_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ownership_decisions_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_attempts_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings_json                JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers_json                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX migration_plan_convergence_request_idx ON migration_plan (convergence_request_id);

ALTER TABLE convergence_request
  ADD CONSTRAINT convergence_request_current_migration_plan_fkey
  FOREIGN KEY (current_migration_plan_id) REFERENCES migration_plan (id);

-- Append-only applies to the factual PREVIEW SNAPSHOT columns only
-- (fingerprint, classes_considered_json, students_affected_json,
-- conflicts_json, assignments_affected_json, active_attempts_snapshot_json,
-- warnings_json, blockers_json) -- these may never change after INSERT,
-- a regeneration always creates a new row (02_25 v1.10 §6.15). The
-- DECISION columns (class_decisions_json, ownership_decisions_json) and
-- status are deliberately excluded from this guard: recording the
-- teacher/school decisions against an already-generated plan (02_38 v1.4
-- §12/§14, "la scelta deve essere esplicita e auditata... in campi JSON
-- dedicati" on this same row) is not a mutation of the plan's factual
-- content, it is the plan's approval outcome.
CREATE FUNCTION reject_migration_plan_update() RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.convergence_request_id <> OLD.convergence_request_id
     OR NEW.fingerprint <> OLD.fingerprint
     OR NEW.classes_considered_json IS DISTINCT FROM OLD.classes_considered_json
     OR NEW.students_affected_json IS DISTINCT FROM OLD.students_affected_json
     OR NEW.conflicts_json IS DISTINCT FROM OLD.conflicts_json
     OR NEW.assignments_affected_json IS DISTINCT FROM OLD.assignments_affected_json
     OR NEW.active_attempts_snapshot_json IS DISTINCT FROM OLD.active_attempts_snapshot_json
     OR NEW.warnings_json IS DISTINCT FROM OLD.warnings_json
     OR NEW.blockers_json IS DISTINCT FROM OLD.blockers_json
     OR NEW.generated_at <> OLD.generated_at
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'migration_plan: preview snapshot columns are append-only after creation, a regeneration always creates a new row (02_25 v1.10 §6.15)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER migration_plan_append_only
  BEFORE UPDATE ON migration_plan
  FOR EACH ROW EXECUTE FUNCTION reject_migration_plan_update();

-- C. migration_execution.
CREATE TABLE migration_execution (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_plan_id                 UUID NOT NULL REFERENCES migration_plan (id),
  convergence_request_id            UUID NOT NULL REFERENCES convergence_request (id),
  convergence_run_id                TEXT NOT NULL UNIQUE,
  status                            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
                                       ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLBACK_REVIEW_REQUIRED')),
  units_total                       INTEGER NOT NULL DEFAULT 0 CHECK (units_total >= 0),
  units_migrated                    INTEGER NOT NULL DEFAULT 0 CHECK (units_migrated >= 0),
  units_failed                      INTEGER NOT NULL DEFAULT 0 CHECK (units_failed >= 0),
  checkpoint_json                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason                    TEXT,
  rollback_review_status            TEXT CHECK (rollback_review_status IS NULL OR rollback_review_status IN
                                       ('PENDING', 'ACCEPTED_PARTIAL', 'RETRY_SCHEDULED')),
  rollback_reviewed_by_staff_account_id UUID REFERENCES staff_account (id),
  rollback_reviewed_at              TIMESTAMPTZ,
  started_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                      TIMESTAMPTZ,
  failed_at                         TIMESTAMPTZ,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX migration_execution_convergence_request_idx ON migration_execution (convergence_request_id);

ALTER TABLE convergence_request
  ADD CONSTRAINT convergence_request_current_migration_execution_fkey
  FOREIGN KEY (current_migration_execution_id) REFERENCES migration_execution (id);

-- D. idempotency_record: three new scopes.
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate',
                     'convergence_request_create', 'convergence_execute')) = (tenant_id IS NULL));

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
                    'convergence_request_create', 'convergence_execute', 'ownership_transfer_promote'));
-- ownership_transfer_promote is tenant-scoped as usual (SCHOOL_ADMIN acting
-- on their own tenant) -- not added to the tenant_id-NULL set.

-- E. capability_grant: four new PLATFORM_ADMIN-only capabilities.
ALTER TABLE capability_grant DROP CONSTRAINT capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global',
     'independent_educator.activate', 'independent_educator.read', 'independent_educator.status.manage',
     'convergence.read', 'convergence.preview', 'convergence.execute', 'convergence.rollback.review'));

-- F. Cross-tenant class migration support: mark the composite FK chain
-- DEFERRABLE INITIALLY DEFERRED. Dynamic (pg_constraint-driven) so this
-- does not depend on guessing Postgres's auto-generated constraint names.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN (
        'school_enrollment'::regclass, 'class_access_code'::regclass, 'assignment'::regclass,
        'assignment_runtime_channel'::regclass, 'staff_class_assignment'::regclass, 'learning_attempt'::regclass
      )
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED', r.tbl, r.conname);
  END LOOP;
END $$;
