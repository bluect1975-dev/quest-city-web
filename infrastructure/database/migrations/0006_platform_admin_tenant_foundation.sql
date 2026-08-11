-- School Pilot Readiness Tranche A: Platform Admin + School Tenant
-- Foundation (02_38 v1.0 §4.1/§5.2/§5.3/§9/§20; AGENTS.md §4 "Platform
-- administration..."; 00_01 v4.66 §8 SCHOOL_PILOT_IMPLEMENTATION_GATE =
-- OPEN for Tranche A).
--
-- PlatformIdentity is a REUSE of `staff_account` (02_38 §20: "Riusa
-- staff_account. Nessuna nuova tabella."), never a second identity table.
-- `platform_admin_grant` is purely additive: it marks which existing
-- `staff_account` rows also hold platform-scoped admin standing, and is
-- intentionally NOT tenant-bound (no tenant_id column) — PLATFORM_ADMIN
-- is platform-scoped, not tenant-scoped (02_38 §5.2) — so the mandatory
-- composite-FK tenant-isolation pattern (02_25 §6.11) does not apply to
-- it, exactly as it does not apply to `staff_account` itself.
--
-- `capability_grant` implements capability-first authorization (02_27
-- §5.3, 02_38 §4.1): role name alone never gates an operation. The five
-- capability strings enabled here are the minimum set this tranche's
-- operations require; four are 02_38 §4.1's exact canonical vocabulary
-- (tenant.create, tenant.suspend, school_admin.activate,
-- audit.read.global); `tenant.read` is an implementer-coined addition
-- (02_38 does not name a read capability) needed for tenant listing,
-- following the same `resource.verb` naming pattern.
--
-- `tenant.status` (ACTIVE/SUSPENDED/ARCHIVED) already exists unchanged
-- since migration 0002 (02_25 §6.1) — no enum change here. This
-- migration only adds the identity/capability/session/audit scaffolding
-- needed to actually enforce and manage it.
--
-- `audit_event` (migration 0002) is reused unmodified, per 02_38 §18.3
-- ("nessuna tabella parallela") — no schema change; only new `action`
-- string values are introduced at the application layer, not the DB
-- layer (`action` has no CHECK constraint).

-- staff_account.created_by_actor_type: extend to allow the two new
-- controlled-provisioning origins this tranche introduces. Same
-- DROP/ADD CONSTRAINT pattern already used by migration 0004 for
-- assignment.created_by_actor_type and idempotency_record.scope.
--   - ADMIN_BOOTSTRAP_SCRIPT: the first PLATFORM_ADMIN, created by
--     tools/bootstrap-platform-admin.ts (02_38 §4.1: "nessun umano
--     tramite auto-registrazione... provisioning amministrativo
--     controllato offline").
--   - PLATFORM_ADMIN: a SCHOOL_ADMIN's staff_account, created by an
--     already-active PLATFORM_ADMIN via the school-admin activation
--     flow (02_38 §4.1 capability school_admin.activate) — distinct
--     from ADMIN_SEED_SCRIPT (offline script, no live actor) because
--     here a live, audited PLATFORM_ADMIN identity is the actor.
ALTER TABLE staff_account DROP CONSTRAINT staff_account_created_by_actor_type_check;
ALTER TABLE staff_account ADD CONSTRAINT staff_account_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'ADMIN_BOOTSTRAP_SCRIPT', 'PLATFORM_ADMIN'));

-- platform_admin_grant: one row per staff_account that holds platform
-- admin standing. UNIQUE(staff_account_id) enforces "at most one grant
-- per identity" — re-suspension/reactivation updates the existing row,
-- never inserts a second one, preserving ONE HUMAN -> ONE PLATFORM
-- IDENTITY (02_38 §9) at the platform-admin layer too.
CREATE TABLE platform_admin_grant (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id      UUID NOT NULL UNIQUE REFERENCES staff_account (id),
  status                TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  granted_by_actor_type TEXT NOT NULL CHECK (granted_by_actor_type IN ('ADMIN_BOOTSTRAP_SCRIPT', 'PLATFORM_ADMIN')),
  granted_by_actor_id   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- capability_grant: capability-first authorization (02_27 §5.3). A
-- platform admin's effective permissions are the union of these rows,
-- never inferred from status/role alone. UNIQUE prevents duplicate
-- grants; least-privilege is enforced by the bootstrap/activation code
-- granting only what each operation actually requires, not by this
-- table's shape.
CREATE TABLE capability_grant (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_grant_id UUID NOT NULL REFERENCES platform_admin_grant (id),
  capability              TEXT NOT NULL CHECK (capability IN
                             ('tenant.create', 'tenant.read', 'tenant.suspend',
                              'school_admin.activate', 'audit.read.global')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_admin_grant_id, capability)
);

-- platform_admin_session: same security posture as staff_session
-- (migration 0004) and student_session (migration 0002) — HttpOnly/
-- Secure/SameSite=Lax cookie, absolute + inactivity TTL, full rotation,
-- specific revocation reasons — but its own distinct table and cookie
-- name (qc_platform_session), never shared with staff_session or
-- student_session (same "never the same cookie, never the same table"
-- discipline as 02_35 §2.1/§4.4). No tenant_id: a platform admin
-- session is platform-scoped for its entire lifetime, mirroring
-- staff_session's own tenant_id being fixed at creation, taken to its
-- logical conclusion of "fixed to no tenant at all".
CREATE TABLE platform_admin_session (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id    UUID NOT NULL REFERENCES staff_account (id),
  token_hash          TEXT NOT NULL UNIQUE,
  csrf_token_hash     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_from        UUID REFERENCES platform_admin_session (id),
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT
                       CHECK (revoked_reason IS NULL
                              OR revoked_reason IN ('USER_LOGOUT', 'ROTATED', 'INACTIVITY_TIMEOUT',
                                                     'ABSOLUTE_EXPIRY', 'ADMIN_REVOKED', 'SECURITY_INCIDENT')),
  CHECK (absolute_expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- idempotency_record.scope: extend for the one Tranche A write operation
-- that is naturally tenant-scoped at request time (the target tenant
-- already exists) — school admin activation. Tenant *creation* has no
-- tenant_id to scope an idempotency record to (idempotency_record.tenant_id
-- is NOT NULL by design, migration 0003) and is deliberately NOT given a
-- forced-fit idempotency mechanism here; see the implementation report
-- for the disclosed, non-blocking follow-up.
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate'));

CREATE INDEX platform_admin_grant_status_idx ON platform_admin_grant (status);
CREATE INDEX capability_grant_grant_idx ON capability_grant (platform_admin_grant_id);
CREATE INDEX platform_admin_session_account_idx ON platform_admin_session (staff_account_id);
CREATE INDEX tenant_status_idx ON tenant (status);
