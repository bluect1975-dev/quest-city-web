import { StaffIdentityError } from "@quest-city-web/staff-identity";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function parseStaffJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new StaffIdentityError("VALIDATION_ERROR", "request body must be a JSON object");
  }
}

export function validateStaffEmail(value: unknown): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 254 || !EMAIL_PATTERN.test(value)) {
    throw new StaffIdentityError("VALIDATION_ERROR", "email must be a valid email address");
  }
  return value;
}

export function validateStaffPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new StaffIdentityError("VALIDATION_ERROR", "password must be a non-empty string");
  }
  return value;
}

export function validateOptionalTenantId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new StaffIdentityError("VALIDATION_ERROR", "tenantId must be a non-empty string when provided");
  }
  return value;
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || key.length < 16 || key.length > 128) {
    throw new StaffIdentityError("VALIDATION_ERROR", "Idempotency-Key header is required (16-128 chars)");
  }
  return key;
}

/** `If-Match` carries the resource's current `version` as a plain integer string (02_26 §8.2). */
export function requireIfMatchVersion(request: Request): number {
  const raw = request.headers.get("if-match");
  const version = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!raw || Number.isNaN(version) || version < 1) {
    throw new StaffIdentityError("VALIDATION_ERROR", "If-Match header is required and must be a positive integer version");
  }
  return version;
}

export function validateStructuredFeedback(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StaffIdentityError("VALIDATION_ERROR", "structuredFeedback must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function validateOptionalFreeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > 10_000) {
    throw new StaffIdentityError("VALIDATION_ERROR", "freeText must be a string up to 10000 characters");
  }
  return value;
}

export function validateOptionalReviewQueueItemId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new StaffIdentityError("VALIDATION_ERROR", "originReviewQueueItemId must be a non-empty string when provided");
  }
  return value;
}

const RUNTIME_CHANNEL_INPUT_VALUES = new Set(["WEB", "ROBLOX"]);

export function validateAllowedRuntimeChannels(value: unknown): Array<"WEB" | "ROBLOX"> {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && RUNTIME_CHANNEL_INPUT_VALUES.has(v))) {
    throw new StaffIdentityError("VALIDATION_ERROR", "allowedRuntimeChannels must be a non-empty array of WEB|ROBLOX");
  }
  return value as Array<"WEB" | "ROBLOX">;
}

export function validateOptionalEnumQueryParam<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (value === null) {
    return undefined;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new StaffIdentityError("VALIDATION_ERROR", `${fieldName} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function validateNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StaffIdentityError("VALIDATION_ERROR", `${fieldName} must be a non-empty string`);
  }
  return value;
}
