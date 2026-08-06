import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque CSPRNG tokens (session token, CSRF token) — high-entropy secrets,
 * unlike the PIN. Hashed with a fast, constant-time-verified digest
 * (sha256) rather than scrypt: a 256-bit random token needs no
 * computational cost factor to resist brute force, and adding one would
 * only cost latency on every authenticated request (WEB-M1 Fase 2
 * correction report, D3).
 */
export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 32;

export function generateToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

/** Constant-time comparison against a stored hash (AGENTS.md WEB-M1 baseline, rule 1). */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(token), "base64url");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "base64url");
  } catch {
    return false;
  }
  if (computed.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(computed, stored);
}
