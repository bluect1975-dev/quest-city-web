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
 */

export const CONTRACT_ARTIFACT_ID = "qc-platform-openapi";
export const CONTRACT_ARTIFACT_VERSION = "1.2.0";

export const CONTRACT_ARTIFACT_ID_V1_3 = "qc-platform-openapi-web-auth";
export const CONTRACT_ARTIFACT_VERSION_V1_3 = "1.3.0";

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
