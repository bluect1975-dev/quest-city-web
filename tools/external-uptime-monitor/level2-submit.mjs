// Level 2 normal path (02_42 v1.2 PARTE U §55/§60): builds the
// ExternalMonitorReportRequest payload, signs it (02_42 §53), and POSTs it
// to the existing endpoint. Never sends Telegram directly -- the endpoint
// itself drives IncidentService/AlertService.
//
// Two distinct paths matter and must never be conflated (see
// feedback_windows_node_script_gotchas item 10, discovered building the
// Level 2 endpoint's own acceptance test): this repo's nginx strips the
// `/api/` prefix before proxying, so the HMAC signature must be computed
// over the POST-strip path the API server actually resolves
// (`/platform/operations/external-monitor-report`), while the actual HTTP
// request the client sends needs the `/api` prefix to reach nginx's
// matching location block in the first place.

import { randomUUID } from "node:crypto";
import { signRequest } from "./hmac.mjs";

export const SIGNED_PATH = "/platform/operations/external-monitor-report";

/** Builds an ExternalMonitorReportRequest body (02_42 §56) from a probe-produced condition. */
export function buildReportBody({ monitorId, observationId, observedAt, environment, condition, state, backfill = false, detectedAt = null, resolvedAt = null }) {
  return {
    monitorId,
    observationId,
    observedAt,
    environment,
    service: condition.service,
    conditionType: condition.conditionType,
    state,
    summaryCode: condition.summaryCode,
    evidence: condition.evidence,
    backfill,
    detectedAt,
    resolvedAt,
  };
}

/**
 * Signs and submits one report. Never sent for a Level 1 (unreachable)
 * observation -- by construction, if the VPS/API is unreachable this call
 * would itself fail, which is exactly why Level 1 exists (02_42 §52).
 */
export async function submitLevel2Report({ apiBaseUrl, secretBytes, keyId, body, timeoutMs = 10_000 }, deps = {}) {
  const { fetchImpl = fetch, nonce = randomUUID(), signRequestImpl = signRequest } = deps;

  const bodyBytes = Buffer.from(JSON.stringify(body), "utf8");
  const headers = signRequestImpl({ method: "POST", path: SIGNED_PATH, bodyBytes, secretBytes, keyId, nonce });
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api${SIGNED_PATH}`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: bodyBytes,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : String(error), body: null };
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON or empty response body -- still report the HTTP status.
  }
  return { ok: response.ok, status: response.status, body: json, error: response.ok ? null : (json?.code ?? json?.message ?? null) };
}
