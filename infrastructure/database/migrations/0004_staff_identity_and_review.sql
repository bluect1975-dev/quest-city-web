-- WEB-M3B: staff identity, authorization, dashboard review and teacher
-- feedback (02_35 v1.0, 02_26 v1.8 §31, AGENTS.md §4.22 v4.33 D6).
--
-- Staff identity is a domain entirely separate from the WEB-M1 student
-- identity model: no table here is shared with, references, or is
-- referenced by `class_access_code`, `school_enrollment` or
-- `student_session` (02_35 §2.1). `staff_account` is global (not
-- tenant-scoped); `staff_tenant_membership` and `staff_class_assignment`
-- carry the tenant/class scope. `staff_session` is scoped to exactly one
-- tenant for its entire lifetime.
--
-- `review_queue_item` and `teacher_feedback` REFERENCE `learning_attempt`
-- by id; neither copies its data, and neither introduces a second attempt
-- ledger (decision D2, unchanged). `assignment` gains two additive columns
-- for the recovery-assignment path (02_35 §11.3) — no second `assignment`
-- table.
--
-- `rate_limit_bucket` and `audit_event` (migration 0002) are reused
-- unmodified — both are already generic enough (scope/bucket_key/
-- window_start; actor_type has no DB-level CHECK) for staff traffic
-- without any schema change.

-- staff_account: global identity, no tenant_id column (02_35 §2.2). No
-- public self-registration endpoint exists anywhere in this milestone —
-- created_by_actor_type mirrors assignment's ADMIN_SEED_SCRIPT-only
-- pattern (migration 0003).
CREATE TABLE staff_account (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  password_algorithm    TEXT NOT NULL CHECK (password_algorithm IN ('scrypt')),
  status                TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  failed_login_count    INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until          TIMESTAMPTZ,
  created_by_actor_type TEXT NOT NULL CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT')),
  created_by_actor_id   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ,
  -- Email is always stored already-normalized (lowercase, trimmed) by the
  -- application layer, same normalize-before-store discipline as
  -- normalizeAlias/normalizeClassCode (packages/identity) — this CHECK
  -- catches a bug that would otherwise silently split one account's
  -- lookups across two differently-cased rows.
  CHECK (email = lower(trim(email)) AND length(email) > 0)
);

-- staff_tenant_membership: associates one staff_account with one tenant
-- and a role. A staff_account MAY have more than one membership (e.g. a
-- coordinator across two schools); a staff_session (below) is always
-- scoped to exactly one membership/tenant at a time.
CREATE TABLE staff_tenant_membership (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id  UUID NOT NULL REFERENCES staff_account (id),
  tenant_id         UUID NOT NULL REFERENCES tenant (id),
  role              TEXT NOT NULL CHECK (role IN ('TEACHER', 'SCHOOL_ADMIN')),
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_account_id, tenant_id),
  UNIQUE (id, tenant_id)
);

-- staff_class_assignment: explicit per-class scope, meaningful only for
-- role = TEACHER (02_35 §3.2 — SCHOOL_ADMIN's scope is the entire tenant,
-- implicitly, no rows here). Enforced by trigger below, not by a CHECK,
-- because the rule spans two tables.
CREATE TABLE staff_class_assignment (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_tenant_membership_id UUID NOT NULL,
  tenant_id                  UUID NOT NULL,
  class_id                   UUID NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (staff_tenant_membership_id, tenant_id) REFERENCES staff_tenant_membership (id, tenant_id),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  UNIQUE (staff_tenant_membership_id, class_id)
);

CREATE FUNCTION reject_staff_class_assignment_for_non_teacher() RETURNS trigger AS $$
DECLARE
  membership_role TEXT;
BEGIN
  SELECT role INTO membership_role FROM staff_tenant_membership WHERE id = NEW.staff_tenant_membership_id;
  IF membership_role IS DISTINCT FROM 'TEACHER' THEN
    RAISE EXCEPTION 'staff_class_assignment: membership % is role %, expected TEACHER (02_35 §3.2)',
      NEW.staff_tenant_membership_id, membership_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_class_assignment_teacher_only
  BEFORE INSERT ON staff_class_assignment
  FOR EACH ROW EXECUTE FUNCTION reject_staff_class_assignment_for_non_teacher();

-- staff_session: same security posture as student_session (migration
-- 0002) — HttpOnly/Secure/SameSite=Lax cookie, absolute + inactivity TTL,
-- rotation, specific revocation reasons — but an entirely separate table,
-- never the same cookie name or row (02_35 §2.1, §4.4). Mono-tenant for
-- its whole lifetime: tenant_id/staff_tenant_membership_id are fixed at
-- creation, never changed by refresh.
CREATE TABLE staff_session (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id            UUID NOT NULL REFERENCES staff_account (id),
  tenant_id                   UUID NOT NULL REFERENCES tenant (id),
  staff_tenant_membership_id  UUID NOT NULL,
  token_hash                  TEXT NOT NULL UNIQUE,
  csrf_token_hash              TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  absolute_expires_at         TIMESTAMPTZ NOT NULL,
  last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_from                UUID,
  revoked_at                  TIMESTAMPTZ,
  revoked_reason               TEXT
                               CHECK (revoked_reason IS NULL
                                      OR revoked_reason IN ('USER_LOGOUT', 'ROTATED', 'INACTIVITY_TIMEOUT',
                                                             'ABSOLUTE_EXPIRY', 'ADMIN_REVOKED', 'SECURITY_INCIDENT')),
  FOREIGN KEY (staff_tenant_membership_id, tenant_id) REFERENCES staff_tenant_membership (id, tenant_id),
  FOREIGN KEY (rotated_from, tenant_id) REFERENCES staff_session (id, tenant_id),
  UNIQUE (id, tenant_id),
  CHECK (absolute_expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- review_queue_item: REFERENCES learning_attempt, never copies its data
-- (02_35 §1 principle 6, §7). Partial unique index prevents duplicate
-- OPEN/IN_REVIEW items for the same attempt while allowing historical
-- RESOLVED/DISMISSED items to coexist (re-flag after reopening).
CREATE TABLE review_queue_item (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant (id),
  class_id                 UUID NOT NULL,
  student_profile_id       UUID NOT NULL,
  learning_attempt_id      UUID NOT NULL,
  reason                   TEXT NOT NULL CHECK (reason IN
                              ('INCORRECT_ATTEMPT', 'OPEN_ANSWER', 'PRIORITY_MISCONCEPTION',
                               'HELP_REQUESTED', 'MANUALLY_SELECTED')),
  priority                 TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  status                   TEXT NOT NULL DEFAULT 'OPEN'
                              CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at              TIMESTAMPTZ,
  reviewer_staff_account_id UUID REFERENCES staff_account (id),
  version                  INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (learning_attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  UNIQUE (id, tenant_id),
  CHECK ((reviewed_at IS NULL) = (reviewer_staff_account_id IS NULL))
);

CREATE UNIQUE INDEX review_queue_item_attempt_active_uq
  ON review_queue_item (learning_attempt_id) WHERE status IN ('OPEN', 'IN_REVIEW');

-- teacher_feedback: two orthogonal status axes (02_35 §9.2), never a
-- single flat enum — publicationStatus is docente-controlled,
-- deliveryStatus is system/runtime-controlled and NOT reset by a
-- publication_status transition to REVOKED (a note already read before
-- revocation stays READ).
CREATE TABLE teacher_feedback (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenant (id),
  class_id                    UUID NOT NULL,
  student_profile_id          UUID NOT NULL,
  learning_attempt_id         UUID NOT NULL,
  author_staff_account_id     UUID NOT NULL REFERENCES staff_account (id),
  structured_feedback         JSONB NOT NULL,
  free_text                   TEXT,
  publication_status          TEXT NOT NULL DEFAULT 'DRAFT'
                                 CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'REVOKED')),
  delivery_status              TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
                                 CHECK (delivery_status IN ('NOT_APPLICABLE', 'PENDING', 'DELIVERED', 'READ', 'FAILED')),
  origin_review_queue_item_id UUID,
  recovery_assignment_id      UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at                TIMESTAMPTZ,
  revoked_at                  TIMESTAMPTZ,
  version                     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (learning_attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  FOREIGN KEY (origin_review_queue_item_id, tenant_id) REFERENCES review_queue_item (id, tenant_id),
  UNIQUE (id, tenant_id),

  -- NULL-safe lifecycle CHECK, same discipline as learning_attempt's
  -- attempt_state CHECK (migration 0003): only IS [NOT] NULL and a
  -- NOT-NULL-guarded IN, never a bare `= literal` on a nullable column.
  CHECK (
    CASE publication_status
      WHEN 'DRAFT' THEN
        delivery_status = 'NOT_APPLICABLE' AND published_at IS NULL AND revoked_at IS NULL
      WHEN 'PUBLISHED' THEN
        delivery_status IN ('PENDING', 'DELIVERED', 'READ', 'FAILED')
        AND published_at IS NOT NULL AND revoked_at IS NULL
      WHEN 'REVOKED' THEN
        -- delivery_status is NOT reset by revocation (02_35 §9.2) — it
        -- keeps whatever value it had (PENDING/DELIVERED/READ/FAILED).
        delivery_status IN ('PENDING', 'DELIVERED', 'READ', 'FAILED')
        AND published_at IS NOT NULL AND revoked_at IS NOT NULL
      ELSE FALSE
    END
  )
);

-- recovery_assignment_id -> assignment(id, tenant_id): added after
-- `assignment` gains its composite (id, tenant_id) unique constraint,
-- which already exists since migration 0003. Deferred to a separate
-- ALTER (rather than inline above) purely for readability -- assignment's
-- own additive columns are defined immediately below this table, so the
-- FK is added right after them, close to what it references.

-- assignment: two additive columns for the recovery-assignment path
-- (02_35 §11.3). No new `assignment`-like table -- existing rows default
-- to origin_type = 'ADMIN_SEED', target_student_profile_id = NULL,
-- meaning their behaviour is completely unchanged by this migration.
ALTER TABLE assignment
  ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'ADMIN_SEED'
    CHECK (origin_type IN ('ADMIN_SEED', 'RECOVERY_FROM_REVIEW')),
  ADD COLUMN target_student_profile_id UUID;

ALTER TABLE assignment
  ADD CONSTRAINT assignment_target_student_profile_fk
    FOREIGN KEY (target_student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id);

-- assignment.created_by_actor_type (migration 0003): extend the allowed
-- values with 'STAFF' -- RecoveryAssignmentService (02_35 §11) is the
-- first staff-authenticated writer of this table, mirroring the same
-- CreatedByActorType TypeScript union already extended in
-- packages/attempts/src/repository/assignment-repository.ts.
ALTER TABLE assignment DROP CONSTRAINT assignment_created_by_actor_type_check;
ALTER TABLE assignment ADD CONSTRAINT assignment_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'SYSTEM', 'STAFF'));

-- Binding invariant (02_35 §11.3): only a RECOVERY_FROM_REVIEW assignment
-- is ever student-scoped; an ADMIN_SEED assignment is never
-- student-scoped (its existing class-wide behaviour, migration 0003,
-- must stay exactly as it is).
ALTER TABLE assignment
  ADD CONSTRAINT assignment_recovery_target_consistency
    CHECK ((origin_type = 'RECOVERY_FROM_REVIEW') = (target_student_profile_id IS NOT NULL));

ALTER TABLE teacher_feedback
  ADD CONSTRAINT teacher_feedback_recovery_assignment_fk
    FOREIGN KEY (recovery_assignment_id, tenant_id) REFERENCES assignment (id, tenant_id);

-- idempotency_record (migration 0003): extend the allowed `scope` values
-- for staff writes. The table, columns and generation-based concurrency
-- mechanism are entirely reused unmodified -- a single idempotency
-- mechanism per operation, never two competing ones (same principle
-- already applied in migration 0003's own header comment).
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create'));

CREATE INDEX staff_tenant_membership_account_idx ON staff_tenant_membership (staff_account_id);
CREATE INDEX staff_class_assignment_membership_idx ON staff_class_assignment (staff_tenant_membership_id);
CREATE INDEX staff_session_account_idx ON staff_session (staff_account_id);
CREATE INDEX review_queue_item_tenant_class_status_idx ON review_queue_item (tenant_id, class_id, status);
CREATE INDEX teacher_feedback_tenant_student_idx ON teacher_feedback (tenant_id, student_profile_id);
CREATE INDEX teacher_feedback_attempt_idx ON teacher_feedback (learning_attempt_id);
