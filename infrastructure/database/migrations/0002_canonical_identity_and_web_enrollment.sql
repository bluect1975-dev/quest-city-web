-- WEB-M1 Phase 2: canonical identity model + Web (class-code/alias/PIN)
-- enrollment tables.
--
-- CANONICAL SHARED BACKEND MODEL, NOT a Web-local schema. `tenant` and
-- `audit_event` are the canonical tables defined by 02_25 §6.1 and §6.10
-- respectively ("riusa la tabella di §6.1" / "riusata senza modifiche").
-- quest-city-web is the first physical implementation of the shared
-- backend (00_01 v4.42; 02_24 §22-23: "la separazione fisica non modifica
-- l'architettura logica della piattaforma... Nessun secondo curriculum o
-- database"; 05_01 §17 lists "duplicazione di database" among the
-- decisions forbidden without a dedicated ADR).
--
-- A second `tenant`, `audit_event` or identity table for Roblox or any
-- other consumer is FORBIDDEN without a dedicated ADR. Canonical entities
-- from §6.1/§6.3 not yet needed by WEB-M1 (school, user_profile,
-- tenant_membership, invitation, permission_override, roblox_link_code,
-- roblox_account_link, roblox_link_audit) extend this same schema in a
-- future migration; they are never introduced as a parallel schema.
--
-- Mandatory cross-cutting constraint (02_25 §6.11): every tenant-bound
-- child table references its parent via a composite foreign key
-- `(id, tenant_id) -> (id, tenant_id)`, never two separate foreign keys.
-- This makes a cross-tenant reference impossible at the database
-- constraint level, not only at the application level.

CREATE TABLE tenant (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id     TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('SCHOOL', 'ORGANIZATION')),
  status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  name          TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE school_class (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenant (id),
  public_id  TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE student_profile (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant (id),
  student_public_id TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

-- No lifetime attempt counter on this row by design (02_25 §6.11): rate
-- limiting for class-code use lives exclusively in `rate_limit_bucket`, to
-- avoid an ambiguous lifetime counter capable of locking out an entire
-- classroom.
CREATE TABLE class_access_code (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  class_id    UUID NOT NULL,
  code_hash   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- code_hash unique only among ACTIVE codes (02_25 §6.11): a revoked/expired
-- code's hash may be reused by a later, unrelated code.
CREATE UNIQUE INDEX class_access_code_hash_active_uq
  ON class_access_code (code_hash) WHERE status = 'ACTIVE';

-- No alias on `student_profile` by design (02_25 §6.11): the alias belongs
-- to the enrollment, not the profile, because the same student may in
-- principle be enrolled under different aliases in different classes.
CREATE TABLE school_enrollment (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  class_id                UUID NOT NULL,
  student_profile_id      UUID NOT NULL,
  access_alias            TEXT NOT NULL CHECK (length(trim(access_alias)) > 0),
  access_alias_normalized TEXT NOT NULL CHECK (length(trim(access_alias_normalized)) > 0),
  pin_hash                TEXT NOT NULL,
  status                  TEXT NOT NULL
                           CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT', 'ARCHIVED')),
  path_id                 TEXT,
  valid_from              TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, tenant_id) REFERENCES school_class (id, tenant_id),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  UNIQUE (class_id, access_alias_normalized),
  UNIQUE (id, tenant_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE student_session (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  enrollment_id      UUID NOT NULL,
  token_hash         TEXT NOT NULL UNIQUE,
  csrf_token_hash    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_from       UUID,
  revoked_at         TIMESTAMPTZ,
  -- D5 correction: no generic LOGOUT/EXPIRED values — every revocation
  -- reason is specific about which absolute vs. inactivity vs. rotation vs.
  -- administrative cause applied.
  revoked_reason     TEXT
                      CHECK (revoked_reason IS NULL
                             OR revoked_reason IN ('USER_LOGOUT', 'ROTATED', 'INACTIVITY_TIMEOUT',
                                                    'ABSOLUTE_EXPIRY', 'ADMIN_REVOKED', 'SECURITY_INCIDENT')),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (enrollment_id, tenant_id) REFERENCES school_enrollment (id, tenant_id),
  -- Self-referential, tenant-scoped: prevents a rotation chain from ever
  -- crossing tenants.
  FOREIGN KEY (rotated_from, tenant_id) REFERENCES student_session (id, tenant_id),
  UNIQUE (id, tenant_id),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE TABLE rate_limit_bucket (
  scope        TEXT NOT NULL,
  bucket_key   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, bucket_key, window_start)
);

-- audit_event: column set identical to 02_25 §6.10, no reduction. Reused
-- as-is for Web identity events, per §6.11's explicit instruction.
CREATE TABLE audit_event (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenant (id),
  actor_type        TEXT NOT NULL,
  actor_id          TEXT,
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  result            TEXT NOT NULL,
  metadata_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
