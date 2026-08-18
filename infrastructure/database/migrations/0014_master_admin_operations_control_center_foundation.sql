-- 0014_master_admin_operations_control_center_foundation: implements the
-- Master Admin Operations Control Center canonical contract
-- (quest-city-roblox main 6cd9c34: 02_42 v1.0, 02_38 v1.5 §19,
-- contracts/quest-city-platform-openapi-v1_17.yaml).
--
-- REPORT_ONLY_TABLE_COUNT_TYPO (disclosed, not silently resolved): 02_42
-- §40 prose says "Sei nuove tabelle" (six) but the table immediately
-- below it lists seven fully-specified entities with complete field-level
-- schemas -- operational_metric_sample, service_health_state,
-- operational_incident, operational_incident_event, alert_configuration,
-- alert_delivery, user_presence. There is no structural ambiguity: all
-- seven are unambiguously and completely defined, none could plausibly
-- be a merge of another. Treated as a numeral-word editorial slip in the
-- canonical doc's prose, not a genuine architectural conflict (confirmed
-- with the requesting user before implementation) -- this migration
-- implements all seven tables exactly as specified. A future canonical
-- micro-correction (02_42 v1.0->v1.1, "Sei"->"Sette") is recommended
-- separately; it is out of scope for this Web-only implementation task,
-- which is explicitly forbidden from touching canonical (mission §76).
--
-- Seven new tables, all additive, none destroying an existing row or
-- capability:
--
--   A. operational_metric_sample -- single generic time-series table for
--      infrastructure/usage/activity/error-aggregate metrics alike (02_42
--      §17-19, §40). One table, not one per metric domain.
--   B. service_health_state -- current + historical per-service health
--      state, distinct from the raw metric samples above (02_42 §21-23).
--   C. operational_incident -- first incident data model in the corpus
--      (02_42 §25-27). Severity reuses 07_06 §19's SEV-1..SEV-4 scale
--      verbatim (TEXT CHECK, not a new taxonomy).
--   D. operational_incident_event -- append-only timeline per incident
--      (02_42 §25, mirrors 07_06 §19's narrative "timeline/impatto/
--      containment/root cause" requirement as machine-readable events).
--   E. alert_configuration -- one row per alert channel (today: TELEGRAM
--      only). Never stores the Bot Token itself -- credential_ref is a
--      pointer to a server-side secret (env var name), never the secret
--      value, per 07_06 §9's existing secret-management regime (02_42
--      §30).
--   F. alert_delivery -- delivery attempt/status tracking, distinct from
--      the incident itself (02_42 §36-37): a delivery failure never
--      alters incident truth.
--   G. user_presence -- single-row-per-actor heartbeat-derived presence
--      (02_42 §14, §40). actor_id is TEXT with no FK, mirroring the
--      existing audit_event.actor_id pattern (migration 0002) --
--      actor_type spans three heterogeneous identity tables
--      (student_profile/staff_account/platform_admin_grant), so a single
--      FK is not possible without three nullable FK columns; this
--      follows the same precedent audit_event already established for
--      exactly this cross-actor-type problem.
--
--   H. idempotency_record: three new tenant-less scopes for the three
--      Idempotency-Key-bearing operations (OpenAPI v1.17.0
--      acknowledgeOperationsIncident, putOperationsAlertConfiguration,
--      sendOperationsAlertTest). Reuses the tenant_id-nullable mechanism
--      migration 0007 already established for platform_tenant_create --
--      same CHECK/partial-unique-index pattern, no second idempotency
--      mechanism (AGENTS.md rule 19 precedent, 02_42 §44).
--
--   I. capability_grant.capability: nine new PLATFORM_ADMIN-only
--      capabilities (operations.dashboard.view, operations.infrastructure.view,
--      operations.usage.view, operations.presence.view, operations.errors.view,
--      operations.incidents.view, operations.incidents.manage,
--      operations.alerting.view, operations.alerting.manage) -- 02_42 §5.
--
-- No existing table is renamed, dropped, or has a column removed.

BEGIN;

-- A. operational_metric_sample
CREATE TABLE operational_metric_sample (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL CHECK (source IN
                  ('APPLICATION', 'DATABASE', 'HOST', 'CONTAINER',
                   'REVERSE_PROXY', 'BACKUP', 'TLS', 'EXTERNAL_MONITOR')),
  metric_key   TEXT NOT NULL CHECK (length(trim(metric_key)) > 0),
  value        DOUBLE PRECISION NOT NULL,
  unit         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN')),
  threshold    DOUBLE PRECISION,
  sampled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Range scan by (source, metric_key, time window) is the only read
-- pattern (02_42 §36 metrics list, §17 peak-concurrency MAX() query) --
-- also backs bounded-retention pruning by sampled_at (02_42 §45).
CREATE INDEX operational_metric_sample_source_key_time_idx
  ON operational_metric_sample (source, metric_key, sampled_at DESC);

-- B. service_health_state
CREATE TABLE service_health_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL CHECK (length(trim(service)) > 0),
  state       TEXT NOT NULL CHECK (state IN ('HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN')),
  latency_ms  DOUBLE PRECISION,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-state-per-service is the primary read (02_42 §21-23 global
-- aggregation); history for a service is a secondary, bounded read.
CREATE INDEX service_health_state_service_time_idx
  ON service_health_state (service, checked_at DESC);

-- C. operational_incident
CREATE TABLE operational_incident (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                     TEXT NOT NULL UNIQUE,
  type                          TEXT NOT NULL CHECK (length(trim(type)) > 0),
  -- Severity reused verbatim from 07_06 §19 -- never a parallel
  -- INFO/WARNING/HIGH/CRITICAL taxonomy (02_42 §26, AGENTS.md §4.30
  -- rule 3).
  severity                      TEXT NOT NULL CHECK (severity IN ('SEV-1', 'SEV-2', 'SEV-3', 'SEV-4')),
  source                        TEXT NOT NULL CHECK (source IN
                                   ('APPLICATION', 'DATABASE', 'HOST', 'CONTAINER',
                                    'REVERSE_PROXY', 'BACKUP', 'TLS', 'EXTERNAL_MONITOR')),
  service                       TEXT NOT NULL CHECK (length(trim(service)) > 0),
  summary                       TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  status                        TEXT NOT NULL DEFAULT 'OPEN'
                                   CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
  -- Dedup key = (type, service, source), 02_42 §27. A repeated identical
  -- failure updates the existing OPEN/ACKNOWLEDGED row (last_seen_at,
  -- occurrence_count) instead of creating a duplicate.
  dedup_key                     TEXT NOT NULL,
  first_seen_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count              INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  acknowledged_at               TIMESTAMPTZ,
  acknowledged_by_staff_account_id UUID REFERENCES staff_account (id),
  resolved_at                   TIMESTAMPTZ,
  resolution_type               TEXT,
  -- Nullable: most incidents (API down, DB down) have no single tenant.
  tenant_id                     UUID REFERENCES tenant (id),
  -- Cooldown tracking for Telegram notification dedup (02_42 §28, §34) --
  -- lives on the incident, not on alert_delivery, since cooldown applies
  -- per dedup_key regardless of which delivery attempt is being
  -- evaluated.
  last_notified_at              TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one OPEN or ACKNOWLEDGED incident per dedup key -- the
-- application-level "find open by dedup_key, else create" logic is
-- backstopped by this constraint so a race condition can never produce
-- two simultaneously-open incidents for the same condition.
CREATE UNIQUE INDEX operational_incident_open_dedup_key_idx
  ON operational_incident (dedup_key)
  WHERE status IN ('OPEN', 'ACKNOWLEDGED');

CREATE INDEX operational_incident_status_severity_idx
  ON operational_incident (status, severity, last_seen_at DESC);

-- D. operational_incident_event
CREATE TABLE operational_incident_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES operational_incident (id),
  event_type   TEXT NOT NULL CHECK (event_type IN
                  ('OPENED', 'REOPENED', 'OCCURRENCE', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED', 'NOTE')),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Mirrors audit_event.actor_type/actor_id (migration 0002): TEXT, no
  -- FK, since the actor may be PLATFORM_ADMIN (staff_account) or SYSTEM
  -- (monitoring itself -- no human actor).
  actor_type   TEXT,
  actor_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX operational_incident_event_incident_time_idx
  ON operational_incident_event (incident_id, created_at);

-- E. alert_configuration -- one row per channel (today: TELEGRAM only).
CREATE TABLE alert_configuration (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel                       TEXT NOT NULL UNIQUE CHECK (channel IN ('TELEGRAM')),
  enabled                       BOOLEAN NOT NULL DEFAULT false,
  severity_threshold            TEXT NOT NULL DEFAULT 'SEV-2'
                                   CHECK (severity_threshold IN ('SEV-1', 'SEV-2', 'SEV-3', 'SEV-4')),
  cooldown_seconds              INTEGER NOT NULL DEFAULT 900 CHECK (cooldown_seconds >= 60),
  -- Never the Bot Token. recipient_ref is masked-safe display metadata
  -- (e.g. a partially redacted chat identifier); credential_ref is a
  -- pointer to where the real secret lives server-side (an env var
  -- name), never the secret value itself (02_42 §30, 07_06 §9).
  recipient_ref                 TEXT,
  credential_ref                TEXT,
  escalation_json                JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_staff_account_id   UUID REFERENCES staff_account (id)
);

-- F. alert_delivery
CREATE TABLE alert_delivery (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a test alert (kind=TEST) has no incident.
  incident_id                   UUID REFERENCES operational_incident (id),
  channel                       TEXT NOT NULL CHECK (channel IN ('TELEGRAM')),
  kind                          TEXT NOT NULL CHECK (kind IN ('ALERT', 'RECOVERY', 'TEST')),
  status                        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count                 INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at               TIMESTAMPTZ,
  next_retry_at                 TIMESTAMPTZ,
  provider_result_normalized    TEXT,
  failure_category               TEXT,
  dedup_key                     TEXT,
  requested_by_staff_account_id UUID REFERENCES staff_account (id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_delivery_incident_idx ON alert_delivery (incident_id);
CREATE INDEX alert_delivery_status_idx ON alert_delivery (status, next_retry_at);

-- G. user_presence -- single row per actor, upserted on heartbeat
-- (02_42 §14-16). State (ONLINE/IDLE/OFFLINE) is always derived at read
-- time from last_seen_at against configurable thresholds -- never
-- persisted as a stored column.
CREATE TABLE user_presence (
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('STUDENT', 'STAFF', 'PLATFORM_ADMIN')),
  actor_id     TEXT NOT NULL,
  tenant_id    UUID REFERENCES tenant (id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_type, actor_id)
);

-- Aggregate ONLINE-count queries filter by tenant_id and scan by
-- last_seen_at recency (02_42 §17, §42 per-school drill-down).
CREATE INDEX user_presence_tenant_last_seen_idx ON user_presence (tenant_id, last_seen_at DESC);

-- H. idempotency_record: three new tenant-less scopes, same
-- tenant_id-nullable mechanism migration 0007 established. The full
-- scope list below is additive over migration 0013's list (every scope
-- introduced by migrations 0004-0013), not a fresh enumeration -- a
-- rewritten CHECK constraint replaces the entire list, so omitting any
-- prior scope here would silently break every write already using it
-- (caught via the full regression suite, mission §66-67).
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
                    'platform_operations_alert_test'));

ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate',
                     'convergence_request_create', 'convergence_execute',
                     'platform_operations_incident_acknowledge',
                     'platform_operations_alert_configuration_update', 'platform_operations_alert_test'))
         = (tenant_id IS NULL));

-- The existing partial unique index idempotency_record_platform_scope_key_idx
-- (migration 0007) already covers ANY scope with tenant_id IS NULL -- it
-- is not scope-specific, so no new index is needed for the three new
-- scopes.

-- I. capability_grant: nine new PLATFORM_ADMIN-only capabilities.
ALTER TABLE capability_grant DROP CONSTRAINT capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global',
     'independent_educator.activate', 'independent_educator.read', 'independent_educator.status.manage',
     'convergence.read', 'convergence.preview', 'convergence.execute', 'convergence.rollback.review',
     'operations.dashboard.view', 'operations.infrastructure.view', 'operations.usage.view',
     'operations.presence.view', 'operations.errors.view', 'operations.incidents.view',
     'operations.incidents.manage', 'operations.alerting.view', 'operations.alerting.manage'));

COMMIT;
