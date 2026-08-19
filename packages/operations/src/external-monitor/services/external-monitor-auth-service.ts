import type { Pool } from "pg";
import { ExternalMonitorKeyMetadataRepository, type ExternalMonitorKeyMetadata } from "../repository/external-monitor-key-metadata-repository";
import { ExternalMonitorNonceRepository } from "../repository/external-monitor-nonce-repository";
import { buildCanonicalString, computeSignatureHex, signaturesMatch } from "../hmac";

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 02_42 §53.4 pilot reference value.
const NONCE_MIN_LENGTH = 16;
const NONCE_MAX_LENGTH = 128;
const KEY_ID_MAX_LENGTH = 64;

/**
 * The four fail-closed checks of 02_42 v1.2 §53.4, in the contract's own
 * order -- each failure is independently sufficient to reject the
 * request, no partial trust. Thrown as one of these four typed reasons;
 * the caller (apps/api's route-context wrapper) maps each to its exact
 * PlatformAdminError code/HTTP status (§67) -- this service never touches
 * HTTP concerns itself, mirroring `requirePlatformAdminIdentity`'s own
 * separation (resolves an identity/throws typed, never touches Response).
 */
export type ExternalMonitorAuthFailureReason =
  | "AUTH_INVALID"
  | "TIMESTAMP_INVALID"
  | "REPLAY_DETECTED"
  | "SIGNATURE_INVALID";

export class ExternalMonitorAuthError extends Error {
  constructor(readonly reason: ExternalMonitorAuthFailureReason, message: string) {
    super(message);
    this.name = "ExternalMonitorAuthError";
  }
}

export interface VerifyExternalMonitorRequestInput {
  method: string;
  path: string;
  timestampHeader: string;
  nonceHeader: string;
  keyIdHeader: string;
  signatureHeader: string;
  rawBody: string;
  /** Resolves the raw secret bytes for a given key's status role -- never persisted, always sourced from env (apps/api/lib/env.ts). */
  resolveSecret: (status: ExternalMonitorKeyMetadata["status"]) => Buffer | null;
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: () => Date;
}

export interface VerifiedExternalMonitorRequest {
  keyId: string;
  keyStatus: ExternalMonitorKeyMetadata["status"];
}

/**
 * Verifies an incoming external-monitor request against all four checks.
 * Structural sibling to `requirePlatformAdminIdentity`
 * (apps/api/lib/platform-request-context.ts) -- a single exported
 * verification entry point every route calls, rather than each route
 * re-implementing auth -- but a genuinely separate, fourth mechanism
 * (02_42 §53), never a reuse of session/CSRF machinery.
 */
export class ExternalMonitorAuthService {
  constructor(private readonly pool: Pool) {}

  async verify(input: VerifyExternalMonitorRequestInput): Promise<VerifiedExternalMonitorRequest> {
    const now = input.now ?? (() => new Date());

    // Structural validation of the header values themselves (bounded
    // lengths per OpenAPI v1.19 `ExternalMonitorNonce`/`ExternalMonitorKeyId`
    // parameter schemas) -- malformed headers are AUTH_INVALID, not a 400
    // PAYLOAD_INVALID (they are part of the auth envelope, not the body).
    if (!input.keyIdHeader || input.keyIdHeader.length > KEY_ID_MAX_LENGTH) {
      throw new ExternalMonitorAuthError("AUTH_INVALID", "X-QC-Monitor-Key-Id missing or malformed.");
    }
    if (
      !input.nonceHeader ||
      input.nonceHeader.length < NONCE_MIN_LENGTH ||
      input.nonceHeader.length > NONCE_MAX_LENGTH
    ) {
      throw new ExternalMonitorAuthError("AUTH_INVALID", "X-QC-Monitor-Nonce missing or out of bounds.");
    }
    if (!input.signatureHeader) {
      throw new ExternalMonitorAuthError("AUTH_INVALID", "X-QC-Monitor-Signature missing.");
    }

    // Check 1 (§53.4): keyId must resolve to a CURRENT or PREVIOUS,
    // non-revoked row.
    const keyMetadata = await new ExternalMonitorKeyMetadataRepository(this.pool).findVerifiable(input.keyIdHeader);
    if (!keyMetadata) {
      throw new ExternalMonitorAuthError("AUTH_INVALID", "Unknown or revoked X-QC-Monitor-Key-Id.");
    }
    const secret = input.resolveSecret(keyMetadata.status);
    if (!secret) {
      // Metadata says CURRENT/PREVIOUS but no matching secret is
      // configured server-side -- fail closed exactly like an unknown
      // keyId, never leak which half of the check failed.
      throw new ExternalMonitorAuthError("AUTH_INVALID", "No secret configured for this key's rotation status.");
    }

    // Check 2 (§53.4): timestamp within tolerance.
    if (!/^[0-9]+$/.test(input.timestampHeader)) {
      throw new ExternalMonitorAuthError("TIMESTAMP_INVALID", "X-QC-Monitor-Timestamp is not a Unix timestamp.");
    }
    const timestampSeconds = Number.parseInt(input.timestampHeader, 10);
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
      throw new ExternalMonitorAuthError("TIMESTAMP_INVALID", "X-QC-Monitor-Timestamp is outside the configured tolerance.");
    }

    // Check 3 (§53.4, §59.A): nonce not already seen for this keyId.
    // Atomic INSERT ... ON CONFLICT DO NOTHING -- race-safe by
    // construction (ExternalMonitorNonceRepository).
    const isNewNonce = await new ExternalMonitorNonceRepository(this.pool).recordIfNew(input.keyIdHeader, input.nonceHeader);
    if (!isNewNonce) {
      throw new ExternalMonitorAuthError("REPLAY_DETECTED", "This (keyId, nonce) pair has already been used.");
    }

    // Check 4 (§53.4): recomputed signature must match, constant-time.
    const canonicalString = buildCanonicalString({
      method: input.method,
      path: input.path,
      timestamp: input.timestampHeader,
      nonce: input.nonceHeader,
      rawBody: input.rawBody,
    });
    const expectedSignature = computeSignatureHex(canonicalString, secret);
    if (!signaturesMatch(input.signatureHeader, expectedSignature)) {
      throw new ExternalMonitorAuthError("SIGNATURE_INVALID", "Recomputed signature does not match X-QC-Monitor-Signature.");
    }

    return { keyId: input.keyIdHeader, keyStatus: keyMetadata.status };
  }
}
