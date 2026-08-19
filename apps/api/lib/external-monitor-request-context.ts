import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { AuditRepository } from "@quest-city-web/identity";
import { ExternalMonitorAuthService, ExternalMonitorAuthError, type VerifiedExternalMonitorRequest } from "@quest-city-web/operations";
import type { ApiEnv } from "./env";
import { getOperationsPoolForQueries } from "./operations-context";

/** 02_42 §62 threat-model-adjacent bound: rejects a body larger than this before it ever reaches JSON.parse or the signature computation. */
export const EXTERNAL_MONITOR_MAX_BODY_BYTES = 16 * 1024;

const REASON_TO_CODE = {
  AUTH_INVALID: "EXTERNAL_MONITOR_AUTH_INVALID",
  TIMESTAMP_INVALID: "EXTERNAL_MONITOR_TIMESTAMP_INVALID",
  REPLAY_DETECTED: "EXTERNAL_MONITOR_REPLAY_DETECTED",
  SIGNATURE_INVALID: "EXTERNAL_MONITOR_SIGNATURE_INVALID",
} as const;

/**
 * Structural sibling to `requirePlatformAdminIdentity`
 * (platform-request-context.ts) -- the single entry point the route
 * calls before touching the request body's business meaning. Reads the
 * raw body itself (the signature is computed over the exact raw bytes,
 * never a re-serialized JSON object) and enforces the bounded-size
 * requirement (02_42 §53, mission §5) before anything else runs.
 */
export async function verifyExternalMonitorRequest(
  request: Request,
  env: ApiEnv,
): Promise<{ verified: VerifiedExternalMonitorRequest; rawBody: string }> {
  const rawBody = await request.text();
  if (rawBody.length > EXTERNAL_MONITOR_MAX_BODY_BYTES) {
    throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", "Request body exceeds the maximum allowed size.");
  }

  const url = new URL(request.url);
  const timestampHeader = request.headers.get("x-qc-monitor-timestamp") ?? "";
  const nonceHeader = request.headers.get("x-qc-monitor-nonce") ?? "";
  const keyIdHeader = request.headers.get("x-qc-monitor-key-id") ?? "";
  const signatureHeader = request.headers.get("x-qc-monitor-signature") ?? "";

  const authService = new ExternalMonitorAuthService(getOperationsPoolForQueries());
  try {
    const verified = await authService.verify({
      method: request.method,
      path: url.pathname,
      timestampHeader,
      nonceHeader,
      keyIdHeader,
      signatureHeader,
      rawBody,
      resolveSecret: (status) =>
        status === "CURRENT" ? env.externalMonitorHmacSecretCurrent : env.externalMonitorHmacSecretPrevious,
    });
    return { verified, rawBody };
  } catch (error) {
    if (error instanceof ExternalMonitorAuthError) {
      // Rejected auth/replay, aggregated and safe (02_42 §69) -- never
      // the signature, secret, canonical string, or raw body.
      await new AuditRepository(getOperationsPoolForQueries()).record({
        tenantId: null,
        actorType: "EXTERNAL_MONITOR",
        actorId: keyIdHeader || null,
        action: "external_monitor_report.rejected",
        targetType: "external_monitor_report",
        result: "FAILURE",
        metadataRedacted: { reason: error.reason },
      });
      throw new PlatformAdminError(REASON_TO_CODE[error.reason], error.message);
    }
    throw error;
  }
}
