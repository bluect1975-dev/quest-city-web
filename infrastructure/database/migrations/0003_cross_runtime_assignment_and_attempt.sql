-- WEB-M2B: cross-runtime assignment and attempt lifecycle.
--
-- Implements the data model approved across the WEB-M2 planning rounds
-- (07_15_01 v1.1, 02_25 §6.5-6.7/§28, 02_26 v1.6 §18). `content_bundle`,
-- `assignment` and `learning_attempt` do not exist yet in this repository
-- (WEB-M1's migration 0002 only created the identity/session tables), so
-- they are created here already complete with the cross-runtime fields —
-- there is no pre-existing row to migrate in this repository specifically.
--
-- attempt = learning_attempt extended (AGENTS.md §4.21 D2): no second
-- `attempt` table is created anywhere in this migration.

-- content_bundle: GLOBAL, not tenant-scoped (02_25 §6.5 baseline — the
-- canonical model has no tenant_id column here; curriculum content is
-- shared across tenants, only assignment/learning_attempt are tenant-scoped).
CREATE TABLE content_bundle (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id            TEXT NOT NULL UNIQUE,
  subject_id           TEXT NOT NULL,
  bundle_version       TEXT NOT NULL,
  bundle_type          TEXT NOT NULL CHECK (bundle_type IN
                          ('COURSE_CATALOG_BUNDLE', 'LESSON_BUNDLE', 'ACTIVITY_BUNDLE',
                           'THEME_BUNDLE', 'ASSET_BUNDLE', 'LOCALIZATION_BUNDLE',
                           'RUNTIME_FIXTURE_BUNDLE')),
  status               TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  manifest_hash        TEXT NOT NULL,
  storage_ref          TEXT NOT NULL,
  published_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, bundle_version, manifest_hash)
);

-- content_bundle_runtime_channel: normalized bridge table, not an array —
-- structurally prevents duplicates (PK) and unknown values (CHECK) without
-- array-domain CHECK trickery.
CREATE TABLE content_bundle_runtime_channel (
  content_bundle_id UUID NOT NULL REFERENCES content_bundle (id),
  runtime_channel    TEXT NOT NULL CHECK (runtime_channel IN ('WEB', 'ROBLOX')),
  PRIMARY KEY (content_bundle_id, runtime_channel)
);

-- content_bundle immutability once PUBLISHED (real DB-level enforcement,
-- not just documented convention). DRAFT rows remain freely editable.
-- Protected fields: public_id, subject_id, bundle_version, bundle_type,
-- manifest_hash, storage_ref. Only permitted status transition once
-- PUBLISHED: -> DEPRECATED.
CREATE FUNCTION reject_content_bundle_published_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'content_bundle %: cannot DELETE a PUBLISHED bundle', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.public_id      IS DISTINCT FROM OLD.public_id
    OR NEW.subject_id     IS DISTINCT FROM OLD.subject_id
    OR NEW.bundle_version IS DISTINCT FROM OLD.bundle_version
    OR NEW.bundle_type    IS DISTINCT FROM OLD.bundle_type
    OR NEW.manifest_hash  IS DISTINCT FROM OLD.manifest_hash
    OR NEW.storage_ref    IS DISTINCT FROM OLD.storage_ref THEN
      RAISE EXCEPTION 'content_bundle %: protected fields are immutable once PUBLISHED', OLD.id;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'DEPRECATED' THEN
      RAISE EXCEPTION 'content_bundle %: PUBLISHED may only transition to DEPRECATED, got %', OLD.id, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_bundle_immutability
  BEFORE UPDATE OR DELETE ON content_bundle
  FOR EACH ROW EXECUTE FUNCTION reject_content_bundle_published_mutation();

-- assignment: tenant-scoped (02_25 §6.6 baseline). No public create/update
-- endpoint (AGENTS.md §4.21 rule 16) — created_by is an administrative seed
-- actor, never a staff identity (none exists yet).
CREATE TABLE assignment (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant (id),
  class_id                 UUID NOT NULL,
  public_id                TEXT NOT NULL UNIQUE,
  title                    TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  opens_at                 TIMESTAMPTZ,
  due_at                   TIMESTAMPTZ,
  created_by_actor_type    TEXT NOT NULL CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'SYSTEM')),
  created_by_actor_id      TEXT NOT NULL,
  completion_policy        TEXT NOT NULL CHECK (completion_policy IN ('FIRST_VALID_COMPLETION')),
  content_bundle_id        UUID NOT NULL REFERENCES content_bundle (id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  UNIQUE (id, tenant_id),
  CHECK (due_at IS NULL OR opens_at IS NULL OR due_at > opens_at)
);

CREATE TABLE assignment_runtime_channel (
  assignment_id   UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  runtime_channel TEXT NOT NULL CHECK (runtime_channel IN ('WEB', 'ROBLOX')),
  PRIMARY KEY (assignment_id, runtime_channel),
  FOREIGN KEY (assignment_id, tenant_id) REFERENCES assignment (id, tenant_id)
);

-- learning_attempt: attempt = learning_attempt extended (AGENTS.md D2).
-- attempt_state / completion_status distinct fields (07_15_01 §11-bis).
-- session_id left nullable, no FK enforced: 02_25 §6.7's session_id refers
-- to `school_session` (§6.6, scheduled live session), a DIFFERENT concept
-- from the WEB-M1 auth `student_session` table already in this repo, and
-- `school_session` does not exist yet here (WEB-M2 is async-attempts only,
-- no live-session concept in scope) — deferred to a future milestone.
CREATE TABLE learning_attempt (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL REFERENCES tenant (id),
  event_id                      TEXT NOT NULL UNIQUE,
  assignment_id                 UUID NOT NULL,
  student_profile_id            UUID NOT NULL,
  enrollment_id                 UUID NOT NULL,
  content_bundle_id             UUID NOT NULL REFERENCES content_bundle (id),
  content_id                    UUID NOT NULL,
  content_version               TEXT NOT NULL,
  session_id                    UUID,
  attempt_state                 TEXT NOT NULL DEFAULT 'CREATED'
                                  CHECK (attempt_state IN
                                    ('CREATED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED',
                                     'COMPLETED', 'ABANDONED', 'EXPIRED')),
  completion_status             TEXT
                                  CHECK (completion_status IS NULL OR completion_status IN
                                    ('ACCEPTED_NOT_CONSOLIDATED', 'RECONCILIATION_REQUIRED', 'CONSOLIDATED')),
  started_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                  TIMESTAMPTZ,
  outcome                       JSONB,
  runtime_channel                TEXT NOT NULL CHECK (runtime_channel IN ('WEB', 'ROBLOX', 'UNKNOWN_LEGACY')),
  runtime_version                TEXT,
  presentation_adapter_version  TEXT,
  theme_id                      TEXT,
  validator_version             TEXT,
  creation_idempotency_key       TEXT NOT NULL,
  FOREIGN KEY (assignment_id, tenant_id) REFERENCES assignment (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (enrollment_id, tenant_id) REFERENCES school_enrollment (id, tenant_id),
  UNIQUE (id, tenant_id),

  -- NULL-safe lifecycle CHECK: uses only IS [NOT] NULL, IS NOT DISTINCT
  -- FROM and an IS-NOT-NULL-guarded IN — never an unguarded `= literal` on
  -- a nullable column, so no branch can evaluate to NULL/UNKNOWN and pass
  -- vacuously (the exact bug found and fixed in the WEB-M2A planning round).
  CHECK (
    CASE attempt_state
      WHEN 'CREATED' THEN
        completion_status IS NULL AND completed_at IS NULL AND outcome IS NULL
      WHEN 'IN_PROGRESS' THEN
        completion_status IS NULL AND completed_at IS NULL AND outcome IS NULL
      WHEN 'COMPLETION_SUBMITTED' THEN
        completion_status IS NOT NULL
        AND completion_status IN ('ACCEPTED_NOT_CONSOLIDATED', 'RECONCILIATION_REQUIRED')
        AND completed_at IS NULL AND outcome IS NULL
      WHEN 'COMPLETED' THEN
        completion_status IS NOT DISTINCT FROM 'CONSOLIDATED'
        AND completed_at IS NOT NULL AND outcome IS NOT NULL
      WHEN 'ABANDONED' THEN
        completion_status IS NULL AND completed_at IS NULL AND outcome IS NULL
      WHEN 'EXPIRED' THEN
        completion_status IS NULL AND completed_at IS NULL AND outcome IS NULL
      ELSE FALSE
    END
  )
);

-- Creation idempotency (distinct from completion idempotency, which lives
-- in idempotency_record, never as a generic column on this table).
CREATE UNIQUE INDEX learning_attempt_creation_idempotency_uq
  ON learning_attempt (tenant_id, assignment_id, student_profile_id, creation_idempotency_key);

-- attempt_response
CREATE TABLE attempt_response (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  attempt_id        UUID NOT NULL,
  item_id           TEXT NOT NULL,
  response_json     JSONB NOT NULL,
  correctness       TEXT CHECK (correctness IN ('CORRECT', 'INCORRECT', 'PARTIAL', 'UNSCORED')),
  validator_version TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  UNIQUE (attempt_id, item_id)
);

-- semantic_action_log: append-only, action_id/client_sequence dedup (no
-- separate idempotency_key column — action_id already serves that role).
CREATE TABLE semantic_action_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  attempt_id        UUID NOT NULL,
  action_id         TEXT NOT NULL,
  action_type       TEXT NOT NULL CHECK (action_type IN
                       ('SELECT_OPTION', 'ENTER_VALUE', 'PLACE_ITEM', 'MOVE_ITEM', 'CONNECT_NODES',
                        'ORDER_ITEMS', 'REQUEST_HINT', 'CONFIRM_SOLUTION', 'RESET_STAGE',
                        'PAUSE_ACTIVITY', 'RESUME_ACTIVITY')),
  target_role       TEXT,
  payload_json      JSONB NOT NULL,
  client_sequence   INTEGER NOT NULL CHECK (client_sequence >= 0),
  runtime_channel   TEXT NOT NULL CHECK (runtime_channel IN ('WEB', 'ROBLOX')),
  adapter_version   TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id),
  UNIQUE (attempt_id, action_id),
  UNIQUE (attempt_id, client_sequence),
  CHECK (occurred_at <= created_at + interval '5 minutes')
);

-- Real append-only enforcement via trigger (no privilege-separation role
-- model exists yet in this repository — docker-compose defines a single
-- POSTGRES_USER owning everything, verified — so a trigger is used instead
-- of GRANT/REVOKE, which would target a nonexistent role. Works regardless
-- of connecting role; layered GRANT/REVOKE can be added later if a roles
-- model is introduced, without removing this trigger.
CREATE FUNCTION reject_semantic_action_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'semantic_action_log is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER semantic_action_log_no_update
  BEFORE UPDATE ON semantic_action_log
  FOR EACH ROW EXECUTE FUNCTION reject_semantic_action_log_mutation();

CREATE TRIGGER semantic_action_log_no_delete
  BEFORE DELETE ON semantic_action_log
  FOR EACH ROW EXECUTE FUNCTION reject_semantic_action_log_mutation();

-- idempotency_record: completion-scope only (semantic actions dedup via
-- semantic_action_log's own UNIQUE constraints, not here — a single
-- mechanism per operation, never two competing ones). generation +
-- failure_retryable support atomic FAILED-row reopening and optimistic
-- concurrency for complete()/fail().
CREATE TABLE idempotency_record (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant (id),
  scope             TEXT NOT NULL CHECK (scope IN ('attempt_completion')),
  scope_key         TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  response_json     JSONB,
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  generation        INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  failure_retryable BOOLEAN,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (
    CASE status
      WHEN 'PENDING'   THEN response_json IS NULL     AND failure_retryable IS NULL
      WHEN 'COMPLETED' THEN response_json IS NOT NULL  AND failure_retryable IS NULL
      WHEN 'FAILED'    THEN response_json IS NOT NULL  AND failure_retryable IS NOT NULL
      ELSE FALSE
    END
  ),
  UNIQUE (tenant_id, scope, scope_key)
);
CREATE INDEX idempotency_record_expires_idx ON idempotency_record (expires_at);
CREATE INDEX idempotency_record_pending_stale_idx ON idempotency_record (created_at) WHERE status = 'PENDING';
