/**
 * @quest-city-web/contracts
 *
 * Consumer-side entry point for the shared Quest City Platform API contract.
 * The canonical OpenAPI document is vendored (not redefined) at
 * `vendor/quest-city-platform-openapi-v1_2.yaml`, with provenance and
 * checksum tracked in `vendor/provenance.json`, per ADR-0005's rule that
 * shared contracts must be consumed as immutable, versioned artifacts —
 * never forked or manually respecified.
 *
 * `vendor/quest-city-platform-openapi-v1_3.yaml` (provenance in
 * `vendor/provenance-v1_3.json`) is a separate, additive artifact — it adds
 * only the WEB-M1 `/web-auth/*` and `/me/student-context` paths and does
 * not replace or modify the v1.2 baseline.
 *
 * `vendor/quest-city-platform-openapi-v1_9.yaml` (provenance in
 * `vendor/provenance-v1_9.json`) is the School Onboarding + Staff
 * Membership contract (School Pilot Readiness Tranche B): 12 paths for
 * staff invitation/membership lifecycle, class + roster management, and
 * general content assignment (`STAFF_GENERAL` origin type). Additive to
 * v1.2 through v1.8; no existing path or schema is touched.
 *
 * `vendor/quest-city-platform-openapi-v1_10.yaml` (provenance in
 * `vendor/provenance-v1_10.json`) is the Student Access + Assignment
 * Discovery contract (School Pilot Readiness Tranche B, final Web
 * compliance patch): redeclares `POST /classes` to emit a one-time
 * `class_access_code` in the same transaction as class creation, adds
 * `POST /classes/{classId}/access-code` (regeneration) and
 * `GET /me/assignments` (student-scoped `STAFF_GENERAL` assignment
 * discovery). Additive to v1.2 through v1.9; no existing path or schema
 * is touched.
 *
 * `vendor/quest-city-platform-openapi-v1_15.yaml` (provenance in
 * `vendor/provenance-v1_15.json`) is the Granular Learning Path Control
 * contract (02_41): `learning-path-policies` CRUD, `learning-path/effective`,
 * Class/Student effective-path preview, `learning-path-alternatives`, plus
 * an additive redeclaration of the three `facilitation-proposals` paths for
 * the `LEARNING_PATH_ADJUSTMENT` proposal type (reuses `facilitation_proposal`,
 * no second proposal table). Additive to v1.2 through v1.14; no existing
 * path or schema is touched.
 *
 * `vendor/quest-city-platform-openapi-v1_16.yaml` (provenance in
 * `vendor/provenance-v1_16.json`) closes the GLPC launch-time enforcement
 * gap (02_41 §41-bis): adds a single `409 LEARNING_PATH_RESOURCE_NOT_AVAILABLE`
 * response to `POST /assignments/{assignmentId}/launch-context`, reusing the
 * GLPC error code introduced by v1_15 rather than adding a sixth GLPC code
 * or a ninth `CrossRuntimeErrorCode` value. Additive over v1.7.0 (the last
 * vendored version to declare the launch-context path group), a separate
 * lineage from v1.2 through v1.15 that never carried this path — a
 * pre-existing, disclosed lineage gap (`PRE_EXISTING_OPENAPI_LAUNCH_CONTEXT_LINEAGE_DEBT`),
 * not resolved here.
 *
 * `vendor/quest-city-platform-openapi-v1_17.yaml` (provenance in
 * `vendor/provenance-v1_17.json`) is the Master Admin Operations Control
 * Center contract (02_42): 10 operations under `/platform/operations/...`
 * (overview, services, metrics, presence, incidents list/detail/acknowledge,
 * alert-configuration read/write, alert-test). Additive over v1.8.0 (the
 * last vendored version to declare the `/platform/...` Platform Admin path
 * group), a separate lineage from v1.9 through v1.16 (school onboarding,
 * independent educator, convergence, GLPC — none of which touch
 * `/platform/...` itself). v1.2.0 through v1.16.0 remain unmodified and
 * independently tracked. Introduces 9 new `PlatformCapability` values
 * (`operations.*`) and 4 new PLATFORM-domain `ErrorEnvelope.code` values.
 *
 * `vendor/quest-city-platform-openapi-v1_18.yaml` (provenance in
 * `vendor/provenance-v1_18.json`) closes the presence-heartbeat contract
 * gap identified during this Web implementation: `02_42 v1.1` §15 adds
 * `POST /presence/heartbeat`, additive over v1.17.0 — a first-level
 * namespace outside `/platform/...`, with a three-alternative `security`
 * array (student/staff/platform, inclusive-OR) so any one of the three
 * session domains may call it. No `Idempotency-Key` (naturally idempotent,
 * server-side coalescing already bounds effect).
 *
 * `vendor/quest-city-platform-openapi-v1_19.yaml` (provenance in
 * `vendor/provenance-v1_19.json`) is the Tranche E2 out-of-band external
 * monitoring contract (`02_42 v1.2` PARTE U, §52-73): `POST
 * /platform/operations/external-monitor-report`, additive over v1.18.0.
 * New dedicated machine-to-machine security scheme `externalMonitorHmac`
 * (HMAC-SHA256 request signing over `X-QC-Monitor-Timestamp/Nonce/
 * Signature/Key-Id`) — never a session cookie, CSRF token, or Basic Auth,
 * and grants zero `PlatformCapability` values. No `Idempotency-Key`
 * (`observationId` in the request body is already the domain-level
 * idempotency key, independently backed by protocol-level `nonce`
 * anti-replay — a different rationale than v1.18.0's naturally-idempotent
 * heartbeat). Severity is deliberately absent from the request schema
 * (always server-derived from `conditionType`). Seven new PLATFORM-domain
 * `ErrorEnvelope.code` values. This is the Level 2 (VPS reachable but
 * degraded) surface only — Level 1 direct Telegram fallback and the
 * GitHub Actions workflow that would call this endpoint are out of scope
 * for the Web implementation consuming this contract version.
 *
 * DISCLOSED GAP — `GET /me/class` (Pilot Product Experience Remediation
 * Tranche G2, added alongside this note): every vendored file above was
 * synced from `quest-city-roblox` (the cross-repo source of truth per
 * ADR-0005) with a verified sha256 checksum against that source. This
 * change set has no access to that repository, so `GET /me/class` is
 * shipped WITHOUT a new vendored OpenAPI version — fabricating a
 * `sourceCommit`/checksum for a sync that never happened would falsify the
 * provenance record ADR-0005 exists to protect. The endpoint is still
 * covered by real integration tests (`tests/integration/`) that pin its
 * request/response shape. `PRE_EXISTING_OPENAPI_ME_CLASS_LINEAGE_DEBT`:
 * resolve by vendoring a proper `v1_20` (or successor) contract version
 * once a `quest-city-roblox` sync is actually performed — same disclosed-
 * debt pattern as v1_16's `PRE_EXISTING_OPENAPI_LAUNCH_CONTEXT_LINEAGE_DEBT`.
 */

export const CONTRACT_ARTIFACT_ID = "qc-platform-openapi";
export const CONTRACT_ARTIFACT_VERSION = "1.2.0";

export const CONTRACT_ARTIFACT_ID_V1_3 = "qc-platform-openapi-web-auth";
export const CONTRACT_ARTIFACT_VERSION_V1_3 = "1.3.0";

export const CONTRACT_ARTIFACT_ID_V1_15 = "qc-platform-openapi-glpc";
export const CONTRACT_ARTIFACT_VERSION_V1_15 = "1.15.0";

export const CONTRACT_ARTIFACT_ID_V1_16 = "qc-platform-openapi-glpc-launch-enforcement";
export const CONTRACT_ARTIFACT_VERSION_V1_16 = "1.16.0";

export const CONTRACT_ARTIFACT_ID_V1_17 = "qc-platform-openapi-master-admin-operations-control-center";
export const CONTRACT_ARTIFACT_VERSION_V1_17 = "1.17.0";

export const CONTRACT_ARTIFACT_ID_V1_18 = "qc-platform-openapi-master-admin-heartbeat";
export const CONTRACT_ARTIFACT_VERSION_V1_18 = "1.18.0";

/**
 * Domain error codes defined by 07_05 §12. The API client must not infer
 * an outcome from a generic HTTP status when a typed domain error exists.
 */
export const DOMAIN_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "CONTENT_NOT_AVAILABLE",
  "CONTENT_VERSION_MISMATCH",
  "ATTEMPT_NOT_FOUND",
  "ATTEMPT_CONFLICT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
  };
  meta: ResponseMeta;
}

export interface ResponseMeta {
  request_id: string;
  api_version: "v1";
}
