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
 */

export const CONTRACT_ARTIFACT_ID = "qc-platform-openapi";
export const CONTRACT_ARTIFACT_VERSION = "1.2.0";

export const CONTRACT_ARTIFACT_ID_V1_3 = "qc-platform-openapi-web-auth";
export const CONTRACT_ARTIFACT_VERSION_V1_3 = "1.3.0";

export const CONTRACT_ARTIFACT_ID_V1_15 = "qc-platform-openapi-glpc";
export const CONTRACT_ARTIFACT_VERSION_V1_15 = "1.15.0";

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
