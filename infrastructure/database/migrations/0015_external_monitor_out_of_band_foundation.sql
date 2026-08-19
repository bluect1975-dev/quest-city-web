-- 0015_external_monitor_out_of_band_foundation: implements the Level 2
-- surface of Tranche E2 Out-of-band Monitoring (quest-city-roblox main
-- ff05f16: 02_42 v1.2 PARTE U §52-73, contracts/quest-city-platform-
-- openapi-v1_19.yaml). Web implementation mission scope: Level 2 only
-- (POST /platform/operations/external-monitor-report). Level 1 direct
-- Telegram fallback and its GitHub Actions workflow are NOT implemented
-- by this or any migration -- they require a separate future
-- authorization (02_42 §62) and touch no database state of their own.
--
-- Two new minimal tables plus one additive column, each individually
-- motivated by 02_42 §65 -- the only deviation from v1.0's "no existing
-- entity modified" principle is the additive `backfilled` column, which
-- 02_42 §65 itself explicitly motivates and pre-authorizes:
--
--   A. external_monitor_key_metadata -- secret rotation metadata only
--      (02_42 §54). NEVER the EXTERNAL_MONITOR_HMAC_SECRET value itself
--      -- that lives exclusively in the VPS secret store and GitHub
--      Actions repository/environment secrets (02_42 §53, AGENTS.md
--      §4.31 rule 3). CURRENT/PREVIOUS/REVOKED lifecycle, at most one
--      CURRENT row at a time (backstopped by a partial unique index, same
--      "app logic backed by a DB constraint" pattern operational_incident
--      already established for its own dedup_key in migration 0014).
--   B. external_monitor_nonce_seen -- protocol-level replay protection
--      (02_42 §59.A), a distinct concept from API idempotency (§59.B,
--      see below). Composite primary key (key_id, nonce) is both the
--      storage and the uniqueness constraint -- a second (key_id, nonce)
--      pair is rejected by the PK itself before any application-level
--      check runs, race-safe under concurrent requests by construction
--      (INSERT ... ON CONFLICT, see the repository layer). Retention is
--      bounded by a periodic purge job operating on seen_at (outside
--      migration scope, same "bounded retention via external job"
--      pattern as operational_metric_sample, 02_42 §45) -- pilot
--      reference retention window is 10 minutes (timestamp tolerance
--      ±300s plus a safety margin, 02_42 §59.A).
--   C. operational_incident.backfilled -- additive, non-breaking column
--      (boolean not null default false, 02_42 §60, §63, §65). Every
--      existing row receives `false` for free; no other column of
--      operational_incident is altered. Marks a report as
--      retroactively recorded after an already-sent Level 1 direct
--      Telegram notification, so the Control Center never gives the
--      false impression of real-time observation for a backfilled
--      incident (02_42 §60).
--
--   D. idempotency_record: one new tenant-less scope,
--      'external_monitor_report_submit' (02_42 §59.B). IMPLEMENTATION
--      NOTE, not a contract deviation: 02_42 §55/AGENTS.md §4.31 rule 8
--      forbid a redundant *HTTP header* (`Idempotency-Key`) on this
--      endpoint, since `observationId` in the request body is already
--      the domain-level idempotency key -- that constraint is about the
--      wire contract (no such header is ever read or required from the
--      caller) and is fully honored here. Internally, this migration
--      reuses the existing, already-tested, race-safe generation-based
--      CAS mechanism `idempotency_record` provides
--      (IdempotencyRecordRepository.begin/complete/fail, migration 0007
--      precedent) keyed by `observationId` as `scope_key` -- rather than
--      hand-rolling a second, weaker dedup/conflict primitive against
--      operational_incident_event's JSONB `detail` column. Same
--      tenant-less pattern already established for the three
--      `platform_operations_*` scopes (migration 0014): rewrite the full
--      scope list (never a partial ALTER, so no earlier scope can be
--      silently dropped) plus the platform-scope/tenant-null CHECK.
--
-- No existing table is renamed, dropped, or has a column removed. No
-- change to capability_grant -- this endpoint grants zero
-- PlatformCapability values (02_42 §55, §72 principle 1); it is
-- authenticated exclusively by the new externalMonitorHmac scheme, never
-- by a capability check. No change to audit_event -- its actor_type
-- column is plain TEXT with no CHECK constraint (migration 0002), so the
-- new "EXTERNAL_MONITOR" actor type value (02_42 §69) requires no schema
-- change, consistent with 02_42 §69's own note that the exact actor_type
-- value is an implementation detail not bound by the canonical contract.

BEGIN;

-- A. external_monitor_key_metadata
CREATE TABLE external_monitor_key_metadata (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id       TEXT NOT NULL UNIQUE CHECK (length(trim(key_id)) > 0),
  status       TEXT NOT NULL CHECK (status IN ('CURRENT', 'PREVIOUS', 'REVOKED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  -- Nullable: the first key of the pilot may be provisioned out of band
  -- (bootstrap), with no PLATFORM_ADMIN actor behind it -- mirrors
  -- alert_configuration.updated_by_staff_account_id's own nullability
  -- rationale for a system-bootstrapped row (migration 0014).
  created_by   UUID REFERENCES staff_account (id)
);

-- At most one CURRENT key at a time (02_42 §54 rotation procedure step 3:
-- "retrocede la riga precedente a PREVIOUS" before/atomically with
-- inserting the new CURRENT row) -- same "app logic backed by a DB
-- constraint" pattern as operational_incident_open_dedup_key_idx
-- (migration 0014), so a rotation race can never leave two simultaneously
-- CURRENT keys.
CREATE UNIQUE INDEX external_monitor_key_metadata_single_current_idx
  ON external_monitor_key_metadata ((true))
  WHERE status = 'CURRENT';

CREATE INDEX external_monitor_key_metadata_status_idx
  ON external_monitor_key_metadata (status);

-- B. external_monitor_nonce_seen -- protocol replay protection (02_42
-- §59.A), distinct from idempotency_record (which covers API idempotency,
-- 02_42 §59.B -- this endpoint's is observationId-based, not header-based,
-- so it does not use idempotency_record at all).
CREATE TABLE external_monitor_nonce_seen (
  key_id   TEXT NOT NULL,
  nonce    TEXT NOT NULL,
  seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, nonce)
);

-- Bounded-retention purge scans by seen_at only (same access pattern as
-- operational_metric_sample_source_key_time_idx's pruning use, migration
-- 0014) -- the PK above already covers the (key_id, nonce) replay-check
-- lookup itself.
CREATE INDEX external_monitor_nonce_seen_seen_at_idx
  ON external_monitor_nonce_seen (seen_at);

-- C. operational_incident.backfilled -- additive, non-breaking.
ALTER TABLE operational_incident
  ADD COLUMN backfilled BOOLEAN NOT NULL DEFAULT false;

-- D. idempotency_record: one new tenant-less scope. Full list rewritten
-- (additive over migration 0014's list, every scope 0004-0014 introduced),
-- never a partial ALTER -- omitting any prior scope here would silently
-- break every write already using it.
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
                    'learning_path_alternative_create',
                    'platform_operations_incident_acknowledge', 'platform_operations_alert_configuration_update',
                    'platform_operations_alert_test',
                    'external_monitor_report_submit'));

ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate',
                     'convergence_request_create', 'convergence_execute',
                     'platform_operations_incident_acknowledge',
                     'platform_operations_alert_configuration_update', 'platform_operations_alert_test',
                     'external_monitor_report_submit'))
         = (tenant_id IS NULL));

-- The existing partial unique index idempotency_record_platform_scope_key_idx
-- (migration 0007) already covers ANY scope with tenant_id IS NULL -- it
-- is not scope-specific, so no new index is needed for this scope either.

COMMIT;
