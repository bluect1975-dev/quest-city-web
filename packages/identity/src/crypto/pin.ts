import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Self-describing, versioned PIN hash format (WEB-M1 Fase 2 D6). Not named
 * "PHC" — it does not implement the formal PHC string format spec, only
 * borrows the general idea of embedding algorithm/params/salt/hash in one
 * string so a stored PIN hash remains verifiable even if the target cost
 * parameters change later.
 *
 * Layout: scrypt$v=1$N=<n>$r=<r>$p=<p>$keylen=<keylen>$<salt-b64url>$<hash-b64url>
 */
export interface ScryptParams {
  n: number;
  r: number;
  p: number;
  keylen: number;
}

// Binding parameters (WEB-M1 Fase 2 authorization). Changing these requires
// a dedicated ADR, not a routine code change.
export const PIN_SCRYPT_PARAMS: ScryptParams = {
  n: 16384,
  r: 8,
  p: 5,
  keylen: 64,
};

export const PIN_SCRYPT_SALT_LENGTH = 16;
export const PIN_SCRYPT_MAXMEM = 32 * 1024 * 1024;

const ALGORITHM = "scrypt";
const FORMAT_VERSION = 1;

// Defensive upper/lower bounds applied to ANY parsed hash before scrypt
// ever executes, independent of the current target parameters above. This
// protects against a corrupted or tampered stored hash forcing an
// oversized computation (D6: "applicare limiti massimi ai parametri prima
// di eseguire scrypt").
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;
const MIN_KEYLEN = 16;
const MAX_KEYLEN = 128;
const MIN_SALT_LENGTH = 16;
const MAX_SALT_LENGTH = 64;
const MIN_HASH_LENGTH = 32;
const MAX_HASH_LENGTH = 128;

export interface ParsedPinHash {
  algorithm: "scrypt";
  version: number;
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

export class PinHashFormatError extends Error {}

export function formatPinHash(params: ScryptParams, salt: Buffer, hash: Buffer): string {
  return [
    ALGORITHM,
    `v=${FORMAT_VERSION}`,
    `N=${params.n}`,
    `r=${params.r}`,
    `p=${params.p}`,
    `keylen=${params.keylen}`,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

const FIELD_PATTERN = /^([A-Za-z]+)=([0-9]+)$/;

/**
 * Parses one `key=value` field at a fixed position and requires it to name
 * exactly `expectedKey` — since the format is strictly positional
 * (`N`, then `r`, then `p`, then `keylen`, always in that order), a
 * mismatched key name catches a duplicated, reordered or unknown field
 * with a single check.
 */
function parseNamedField(field: string, expectedKey: string): number {
  const match = FIELD_PATTERN.exec(field);
  if (!match) {
    throw new PinHashFormatError(`PIN_HASH_MALFORMED: unparseable field "${field}"`);
  }
  // Cast is safe: FIELD_PATTERN has exactly 2 capture groups, and `match`
  // is confirmed non-null above — the array always has this exact shape.
  const [, key, rawValue] = match as unknown as [string, string, string];
  if (key !== expectedKey) {
    throw new PinHashFormatError(`PIN_HASH_MALFORMED: expected field "${expectedKey}", got "${key}"`);
  }
  return Number.parseInt(rawValue, 10);
}

/**
 * Parses and fully validates a stored PIN hash string. Rejects missing,
 * duplicate, reordered or unknown fields, and rejects parameters outside
 * defensive bounds before any scrypt computation is attempted.
 */
export function parsePinHash(stored: string): ParsedPinHash {
  const rawParts = stored.split("$");
  if (rawParts.length !== 8) {
    throw new PinHashFormatError("PIN_HASH_MALFORMED: expected 8 '$'-separated fields");
  }
  // Cast is safe: length is confirmed === 8 immediately above.
  const [algorithm, versionField, nField, rField, pField, keylenField, saltField, hashField] = rawParts as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) {
    throw new PinHashFormatError(`PIN_HASH_MALFORMED: unknown algorithm "${algorithm}"`);
  }

  const versionMatch = /^v=([0-9]+)$/.exec(versionField);
  if (!versionMatch) {
    throw new PinHashFormatError("PIN_HASH_MALFORMED: missing or invalid version field");
  }
  const [, versionRaw] = versionMatch as unknown as [string, string];
  const version = Number.parseInt(versionRaw, 10);
  if (version !== FORMAT_VERSION) {
    throw new PinHashFormatError(`PIN_HASH_UNSUPPORTED_VERSION: ${version}`);
  }

  const params: ScryptParams = {
    n: parseNamedField(nField, "N"),
    r: parseNamedField(rField, "r"),
    p: parseNamedField(pField, "p"),
    keylen: parseNamedField(keylenField, "keylen"),
  };

  if (!Number.isInteger(params.n) || params.n < 2 || (params.n & (params.n - 1)) !== 0 || params.n > MAX_N) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: N must be a power of two within bounds");
  }
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > MAX_R) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: r out of bounds");
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > MAX_P) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: p out of bounds");
  }
  if (!Number.isInteger(params.keylen) || params.keylen < MIN_KEYLEN || params.keylen > MAX_KEYLEN) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: keylen out of bounds");
  }
  if (128 * params.n * params.r > PIN_SCRYPT_MAXMEM) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: exceeds configured maxmem");
  }

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltField, "base64url");
    hash = Buffer.from(hashField, "base64url");
  } catch {
    throw new PinHashFormatError("PIN_HASH_MALFORMED: invalid base64url encoding");
  }
  if (salt.length < MIN_SALT_LENGTH || salt.length > MAX_SALT_LENGTH) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: salt length out of bounds");
  }
  if (hash.length < MIN_HASH_LENGTH || hash.length > MAX_HASH_LENGTH || hash.length !== params.keylen) {
    throw new PinHashFormatError("PIN_HASH_PARAMS_OUT_OF_RANGE: hash length inconsistent with keylen");
  }

  return { algorithm: "scrypt", version, params, salt, hash };
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(PIN_SCRYPT_SALT_LENGTH);
  const derived = await scryptAsync(pin, salt, PIN_SCRYPT_PARAMS.keylen, {
    N: PIN_SCRYPT_PARAMS.n,
    r: PIN_SCRYPT_PARAMS.r,
    p: PIN_SCRYPT_PARAMS.p,
    maxmem: PIN_SCRYPT_MAXMEM,
  });
  return formatPinHash(PIN_SCRYPT_PARAMS, salt, derived);
}

/**
 * Verifies a candidate PIN against a stored hash. A malformed stored hash
 * is treated as a non-match rather than propagated as an exception to the
 * caller's control flow, since the caller (session/start) must always
 * return the same uniform ACCESS_CREDENTIALS_INVALID regardless of cause.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  let parsed: ParsedPinHash;
  try {
    parsed = parsePinHash(stored);
  } catch {
    return false;
  }
  const derived = await scryptAsync(pin, parsed.salt, parsed.params.keylen, {
    N: parsed.params.n,
    r: parsed.params.r,
    p: parsed.params.p,
    maxmem: PIN_SCRYPT_MAXMEM,
  });
  if (derived.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, parsed.hash);
}

/**
 * Supports future recognition of hashes that should be upgraded (D6): a
 * stored hash whose version or parameters no longer match the current
 * target is flagged so the caller can transparently rehash after a
 * successful verification, without a data migration.
 */
export function needsRehash(stored: string): boolean {
  let parsed: ParsedPinHash;
  try {
    parsed = parsePinHash(stored);
  } catch {
    return true;
  }
  return (
    parsed.version !== FORMAT_VERSION ||
    parsed.params.n !== PIN_SCRYPT_PARAMS.n ||
    parsed.params.r !== PIN_SCRYPT_PARAMS.r ||
    parsed.params.p !== PIN_SCRYPT_PARAMS.p ||
    parsed.params.keylen !== PIN_SCRYPT_PARAMS.keylen
  );
}
