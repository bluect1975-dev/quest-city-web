import type { SequenceRuntimeState } from "@quest-city-web/content-runtime";

/**
 * Client for `/attempts/{attemptId}/sequence-runtime-state` (R3C.3;
 * re-scoped from `/sequence-runtime-state/{sequenceId}` by migration 0019
 * — UAT Failure Remediation, `UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01`: two
 * independent attempts against the same sequence must never share
 * progress/completion state), proxied through Nginx's existing
 * `location /api/` (`infrastructure/reverse-proxy/nginx.conf`).
 * `NEXT_PUBLIC_API_BASE_URL` is already declared for `student-web` in
 * `docker-compose.yml` but was unused by any client code before this —
 * this is its first consumer. `credentials: "include"` sends the httpOnly
 * session cookie; the CSRF token itself is never httpOnly (returned once,
 * in the session-start JSON body) and must be supplied by the caller —
 * this module never reads it from storage itself, keeping it a pure,
 * directly-testable fetch wrapper (see `session-client.ts` for where the
 * caller gets it from).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export class SequenceRuntimeStateClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SequenceRuntimeStateClientError";
  }
}

export type SequenceRuntimeStateLoadResult = { found: true; state: SequenceRuntimeState; version: number } | { found: false };

async function errorFromResponse(response: Response): Promise<SequenceRuntimeStateClientError> {
  const body = await response.json().catch(() => null);
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  const message = body && typeof body === "object" ? (body as { message?: unknown }).message : undefined;
  return new SequenceRuntimeStateClientError(
    typeof message === "string" ? message : `Request failed (${response.status})`,
    response.status,
    typeof code === "string" ? code : undefined,
  );
}

export async function loadSequenceRuntimeState(attemptId: string): Promise<SequenceRuntimeStateLoadResult> {
  const response = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/sequence-runtime-state`, {
    method: "GET",
    credentials: "include",
  });
  if (response.status === 404) {
    return { found: false };
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const body = (await response.json()) as { data: { state: SequenceRuntimeState; version: number } };
  return { found: true, state: body.data.state, version: body.data.version };
}

export async function createSequenceRuntimeState(
  attemptId: string,
  state: SequenceRuntimeState,
  csrfToken: string,
): Promise<{ state: SequenceRuntimeState; version: number }> {
  const response = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/sequence-runtime-state`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return ((await response.json()) as { data: { state: SequenceRuntimeState; version: number } }).data;
}

/** Throws `SequenceRuntimeStateClientError` with `code === "SEQUENCE_RUNTIME_STATE_VERSION_CONFLICT"` (HTTP 409) on a stale `expectedVersion` — the caller must reload and reconcile, never blindly retry the same write. */
export async function saveSequenceRuntimeState(
  attemptId: string,
  state: SequenceRuntimeState,
  expectedVersion: number,
  csrfToken: string,
): Promise<{ state: SequenceRuntimeState; version: number }> {
  const response = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/sequence-runtime-state`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ state, expectedVersion }),
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return ((await response.json()) as { data: { state: SequenceRuntimeState; version: number } }).data;
}
