import { IdentityError } from "@quest-city-web/identity";

const PIN_PATTERN = /^[0-9]+$/;

/** Mirrors `contracts/quest-city-platform-openapi-v1_3.yaml` request schemas exactly. */
export function validateClassCode(value: unknown): string {
  if (typeof value !== "string" || value.length < 4 || value.length > 32) {
    throw new IdentityError("VALIDATION_ERROR", "classCode must be a string between 4 and 32 characters");
  }
  return value;
}

export function validateAccessAlias(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    throw new IdentityError("VALIDATION_ERROR", "accessAlias must be a string between 1 and 64 characters");
  }
  return value;
}

export function validatePin(value: unknown): string {
  if (typeof value !== "string" || value.length < 6 || value.length > 8 || !PIN_PATTERN.test(value)) {
    throw new IdentityError("VALIDATION_ERROR", "pin must be a 6-8 digit numeric string");
  }
  return value;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new IdentityError("VALIDATION_ERROR", "request body must be a JSON object");
  }
}
