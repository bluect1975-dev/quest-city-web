import { PlatformAdminError } from "@quest-city-web/platform-admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function parsePlatformJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new PlatformAdminError("VALIDATION_ERROR", "request body must be a JSON object");
  }
}

export function validatePlatformEmail(value: unknown): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 254 || !EMAIL_PATTERN.test(value)) {
    throw new PlatformAdminError("VALIDATION_ERROR", "email must be a valid email address");
  }
  return value;
}

export function validatePlatformPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new PlatformAdminError("VALIDATION_ERROR", "password must be a non-empty string");
  }
  return value;
}

export function validateTenantName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 200) {
    throw new PlatformAdminError("VALIDATION_ERROR", "name must be 1-200 characters");
  }
  return value;
}

const TENANT_STATUS_VALUES = new Set(["ACTIVE", "SUSPENDED"]);

export function validateTenantStatusInput(value: unknown): "ACTIVE" | "SUSPENDED" {
  if (typeof value !== "string" || !TENANT_STATUS_VALUES.has(value)) {
    throw new PlatformAdminError("VALIDATION_ERROR", "status must be one of: ACTIVE, SUSPENDED");
  }
  return value as "ACTIVE" | "SUSPENDED";
}

export function validatePaginationQuery(url: URL): { limit: number; offset: number } {
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
  const offset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new PlatformAdminError("VALIDATION_ERROR", "limit must be an integer between 1 and 100");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new PlatformAdminError("VALIDATION_ERROR", "offset must be a non-negative integer");
  }
  return { limit, offset };
}
