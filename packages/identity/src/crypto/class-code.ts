import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Class access code generation. Excludes visually ambiguous characters
 * (0/O, 1/I) — codes are read aloud and typed by a classroom of students,
 * so legibility matters more than raw entropy for a shared, revocable,
 * rate-limited secret (not a long-term one). Within the OpenAPI v1.3
 * `ClassCodeResolveRequest.classCode` bound (minLength 4, maxLength 32).
 */
const CLASS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLASS_CODE_LENGTH = 8;

export function generateClassCode(length: number = CLASS_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  }
  return code;
}

/** Generated PIN: 6 digits (WEB-M1 baseline). Accepted range (6-8) is validated at the API boundary, not here. */
export const GENERATED_PIN_LENGTH = 6;

export function generatePin(length: number = GENERATED_PIN_LENGTH): string {
  let pin = "";
  for (let i = 0; i < length; i += 1) {
    pin += randomInt(10).toString();
  }
  return pin;
}

/**
 * Class-code hashing: HMAC-SHA-256 keyed by a dedicated, server-side-only
 * pepper (`CLASS_CODE_HASH_PEPPER`) — not plain SHA-256. A class code has
 * far less entropy than a 256-bit session/CSRF token (8 characters from a
 * 33-symbol alphabet, deliberately legible for a classroom), so an
 * attacker who obtained the `class_access_code` table without the pepper
 * must not be able to precompute or verify guesses offline. Session and
 * CSRF tokens remain plain SHA-256 (`crypto/token.ts`) — they are
 * high-entropy CSPRNG values where a keyed hash adds no defense.
 */
export const CLASS_CODE_PEPPER_MIN_BYTES = 32;

export class ClassCodePepperError extends Error {}

/**
 * Decodes and validates a `CLASS_CODE_HASH_PEPPER` env value (base64).
 * Never includes the raw value in its error messages — only lengths and
 * the variable name — so a validation failure can be logged safely.
 * Callers decide whether a missing pepper is fatal for their environment;
 * this repository requires it unconditionally (no default, in every
 * environment — see `apps/api/lib/env.ts` and `tools/seed-pilot.ts`).
 */
export function decodeClassCodePepper(raw: string | undefined): Buffer {
  if (!raw || raw.length === 0) {
    throw new ClassCodePepperError("CLASS_CODE_HASH_PEPPER is not set.");
  }
  let pepper: Buffer;
  try {
    pepper = Buffer.from(raw, "base64");
  } catch {
    throw new ClassCodePepperError("CLASS_CODE_HASH_PEPPER is not valid base64.");
  }
  if (pepper.length < CLASS_CODE_PEPPER_MIN_BYTES) {
    throw new ClassCodePepperError(
      `CLASS_CODE_HASH_PEPPER must decode to at least ${CLASS_CODE_PEPPER_MIN_BYTES} bytes, got ${pepper.length}.`,
    );
  }
  return pepper;
}

/**
 * Deterministic lookup hash for a normalized class code: same code + same
 * pepper always produce the same digest (required for the `code_hash`
 * equality lookup in `class_access_code`); a different pepper or a
 * different code always produce a different digest.
 */
export function hashClassCode(normalizedCode: string, pepper: Buffer): string {
  return createHmac("sha256", pepper).update(normalizedCode, "utf8").digest("base64url");
}

/**
 * Constant-time comparison, for the (currently hypothetical) case where a
 * computed digest is compared in application code rather than via a
 * database equality lookup — the primary `class_access_code` lookup path
 * uses an indexed SQL `WHERE code_hash = $1`, which is a database
 * operation, not an in-process secret comparison; this helper exists so
 * that guarantee still holds if a future caller ever needs to compare two
 * already-fetched digests directly.
 */
export function compareClassCodeHash(computed: string, stored: string): boolean {
  const a = Buffer.from(computed, "base64url");
  let b: Buffer;
  try {
    b = Buffer.from(stored, "base64url");
  } catch {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
