import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Self-describing, versioned staff-password hash format (02_35 §4.1):
 * "hashing della password richiede una funzione a costo di memoria
 * elevato (scrypt o argon2id), stessa classe crittografica già impiegata
 * per il PIN studente" — same discipline as
 * `@quest-city-web/identity`'s `crypto/pin.ts` (self-describing versioned
 * format, defensive parameter bounds before any scrypt computation),
 * implemented as its own self-contained module rather than imported: a
 * staff password and a student PIN are different credential classes with
 * different entropy/length characteristics, and this package intentionally
 * shares no identity-mechanism code with `@quest-city-web/identity`
 * (02_35 §2.1 — only read repositories for tenant/class/student/enrollment
 * are reused, never the credential/session mechanism itself).
 *
 * Layout: scrypt$v=1$N=<n>$r=<r>$p=<p>$keylen=<keylen>$<salt-b64url>$<hash-b64url>
 */
export interface ScryptParams {
  n: number;
  r: number;
  p: number;
  keylen: number;
}

/**
 * Higher cost factor than the student PIN (N=16384 in packages/identity):
 * a staff account is higher-privilege, and unlike a PIN a password is not
 * latency-sensitive on every classroom login burst.
 */
export const PASSWORD_SCRYPT_PARAMS: ScryptParams = {
  n: 32768,
  r: 8,
  p: 5,
  keylen: 64,
};

export const PASSWORD_SCRYPT_SALT_LENGTH = 16;
export const PASSWORD_SCRYPT_MAXMEM = 64 * 1024 * 1024;

const ALGORITHM = "scrypt";
const FORMAT_VERSION = 1;

const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;
const MIN_KEYLEN = 16;
const MAX_KEYLEN = 128;
const MIN_SALT_LENGTH = 16;
const MAX_SALT_LENGTH = 64;
const MIN_HASH_LENGTH = 32;
const MAX_HASH_LENGTH = 128;

export interface ParsedPasswordHash {
  algorithm: "scrypt";
  version: number;
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

export class PasswordHashFormatError extends Error {}

export function formatPasswordHash(params: ScryptParams, salt: Buffer, hash: Buffer): string {
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

function parseNamedField(field: string, expectedKey: string): number {
  const match = FIELD_PATTERN.exec(field);
  if (!match) {
    throw new PasswordHashFormatError(`PASSWORD_HASH_MALFORMED: unparseable field "${field}"`);
  }
  const [, key, rawValue] = match as unknown as [string, string, string];
  if (key !== expectedKey) {
    throw new PasswordHashFormatError(`PASSWORD_HASH_MALFORMED: expected field "${expectedKey}", got "${key}"`);
  }
  return Number.parseInt(rawValue, 10);
}

/** Parses and fully validates a stored password hash string, defensive-bounded before any scrypt computation. */
export function parsePasswordHash(stored: string): ParsedPasswordHash {
  const rawParts = stored.split("$");
  if (rawParts.length !== 8) {
    throw new PasswordHashFormatError("PASSWORD_HASH_MALFORMED: expected 8 '$'-separated fields");
  }
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
    throw new PasswordHashFormatError(`PASSWORD_HASH_MALFORMED: unknown algorithm "${algorithm}"`);
  }

  const versionMatch = /^v=([0-9]+)$/.exec(versionField);
  if (!versionMatch) {
    throw new PasswordHashFormatError("PASSWORD_HASH_MALFORMED: missing or invalid version field");
  }
  const [, versionRaw] = versionMatch as unknown as [string, string];
  const version = Number.parseInt(versionRaw, 10);
  if (version !== FORMAT_VERSION) {
    throw new PasswordHashFormatError(`PASSWORD_HASH_UNSUPPORTED_VERSION: ${version}`);
  }

  const params: ScryptParams = {
    n: parseNamedField(nField, "N"),
    r: parseNamedField(rField, "r"),
    p: parseNamedField(pField, "p"),
    keylen: parseNamedField(keylenField, "keylen"),
  };

  if (!Number.isInteger(params.n) || params.n < 2 || (params.n & (params.n - 1)) !== 0 || params.n > MAX_N) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: N must be a power of two within bounds");
  }
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > MAX_R) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: r out of bounds");
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > MAX_P) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: p out of bounds");
  }
  if (!Number.isInteger(params.keylen) || params.keylen < MIN_KEYLEN || params.keylen > MAX_KEYLEN) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: keylen out of bounds");
  }
  if (128 * params.n * params.r > PASSWORD_SCRYPT_MAXMEM) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: exceeds configured maxmem");
  }

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltField, "base64url");
    hash = Buffer.from(hashField, "base64url");
  } catch {
    throw new PasswordHashFormatError("PASSWORD_HASH_MALFORMED: invalid base64url encoding");
  }
  if (salt.length < MIN_SALT_LENGTH || salt.length > MAX_SALT_LENGTH) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: salt length out of bounds");
  }
  if (hash.length < MIN_HASH_LENGTH || hash.length > MAX_HASH_LENGTH || hash.length !== params.keylen) {
    throw new PasswordHashFormatError("PASSWORD_HASH_PARAMS_OUT_OF_RANGE: hash length inconsistent with keylen");
  }

  return { algorithm: "scrypt", version, params, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SCRYPT_SALT_LENGTH);
  const derived = await scryptAsync(password, salt, PASSWORD_SCRYPT_PARAMS.keylen, {
    N: PASSWORD_SCRYPT_PARAMS.n,
    r: PASSWORD_SCRYPT_PARAMS.r,
    p: PASSWORD_SCRYPT_PARAMS.p,
    maxmem: PASSWORD_SCRYPT_MAXMEM,
  });
  return formatPasswordHash(PASSWORD_SCRYPT_PARAMS, salt, derived);
}

/**
 * A malformed stored hash is treated as a non-match rather than thrown,
 * so the caller (staff-auth session/start) always returns the same
 * uniform STAFF_AUTH_REQUIRED regardless of cause (02_35 §4.6).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let parsed: ParsedPasswordHash;
  try {
    parsed = parsePasswordHash(stored);
  } catch {
    return false;
  }
  const derived = await scryptAsync(password, parsed.salt, parsed.params.keylen, {
    N: parsed.params.n,
    r: parsed.params.r,
    p: parsed.params.p,
    maxmem: PASSWORD_SCRYPT_MAXMEM,
  });
  if (derived.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, parsed.hash);
}

export function needsRehash(stored: string): boolean {
  let parsed: ParsedPasswordHash;
  try {
    parsed = parsePasswordHash(stored);
  } catch {
    return true;
  }
  return (
    parsed.version !== FORMAT_VERSION ||
    parsed.params.n !== PASSWORD_SCRYPT_PARAMS.n ||
    parsed.params.r !== PASSWORD_SCRYPT_PARAMS.r ||
    parsed.params.p !== PASSWORD_SCRYPT_PARAMS.p ||
    parsed.params.keylen !== PASSWORD_SCRYPT_PARAMS.keylen
  );
}
