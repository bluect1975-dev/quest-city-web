import { describe, expect, it } from "vitest";
import {
  PIN_SCRYPT_PARAMS,
  PinHashFormatError,
  formatPinHash,
  hashPin,
  needsRehash,
  parsePinHash,
  verifyPin,
} from "./pin";

describe("hashPin / verifyPin", () => {
  it("round-trips a correct PIN", async () => {
    const stored = await hashPin("482913");
    await expect(verifyPin("482913", stored)).resolves.toBe(true);
  });

  it("rejects an incorrect PIN", async () => {
    const stored = await hashPin("482913");
    await expect(verifyPin("000000", stored)).resolves.toBe(false);
  });

  it("produces the documented format with the binding parameters", async () => {
    const stored = await hashPin("123456");
    expect(stored.startsWith("scrypt$v=1$N=16384$r=8$p=5$keylen=64$")).toBe(true);
  });

  it("produces a fresh, distinct salt on every call (never reuses a salt)", async () => {
    const a = await hashPin("123456");
    const b = await hashPin("123456");
    expect(a).not.toBe(b);
  });

  it("treats a malformed stored hash as a non-match rather than throwing", async () => {
    await expect(verifyPin("123456", "not-a-valid-hash")).resolves.toBe(false);
  });
});

describe("formatPinHash / parsePinHash round-trip", () => {
  it("parses back exactly what was formatted", () => {
    const salt = Buffer.from("0123456789abcdef", "utf8").subarray(0, 16);
    const hash = Buffer.alloc(64, 7);
    const formatted = formatPinHash(PIN_SCRYPT_PARAMS, salt, hash);
    const parsed = parsePinHash(formatted);
    expect(parsed.params).toEqual(PIN_SCRYPT_PARAMS);
    expect(parsed.salt.equals(salt)).toBe(true);
    expect(parsed.hash.equals(hash)).toBe(true);
  });
});

describe("parsePinHash — rejects malformed input (D6)", () => {
  const salt = Buffer.alloc(16, 1).toString("base64url");
  const hash = Buffer.alloc(64, 2).toString("base64url");
  const valid = `scrypt$v=1$N=16384$r=8$p=5$keylen=64$${salt}$${hash}`;

  it("accepts a well-formed hash (sanity check for the fixture itself)", () => {
    expect(() => parsePinHash(valid)).not.toThrow();
  });

  it("rejects an unknown algorithm", () => {
    expect(() => parsePinHash(valid.replace("scrypt", "argon2"))).toThrow(PinHashFormatError);
  });

  it("rejects a missing version field", () => {
    const withoutVersion = valid.replace("v=1$", "");
    expect(() => parsePinHash(withoutVersion)).toThrow(PinHashFormatError);
  });

  it("rejects an unsupported version", () => {
    expect(() => parsePinHash(valid.replace("v=1", "v=2"))).toThrow(/PIN_HASH_UNSUPPORTED_VERSION/);
  });

  it("rejects a wrong field count (missing field)", () => {
    const missingP = `scrypt$v=1$N=16384$r=8$keylen=64$${salt}$${hash}`;
    expect(() => parsePinHash(missingP)).toThrow(PinHashFormatError);
  });

  it("rejects an extra/duplicate field", () => {
    const extra = `scrypt$v=1$N=16384$N=16384$r=8$p=5$keylen=64$${salt}$${hash}`;
    expect(() => parsePinHash(extra)).toThrow(PinHashFormatError);
  });

  it("rejects reordered fields (r before N)", () => {
    const reordered = `scrypt$v=1$r=8$N=16384$p=5$keylen=64$${salt}$${hash}`;
    expect(() => parsePinHash(reordered)).toThrow(PinHashFormatError);
  });

  it("rejects an unknown field name in a parameter position", () => {
    const unknown = `scrypt$v=1$X=16384$r=8$p=5$keylen=64$${salt}$${hash}`;
    expect(() => parsePinHash(unknown)).toThrow(PinHashFormatError);
  });

  it("rejects N that is not a power of two", () => {
    const badN = valid.replace("N=16384", "N=16000");
    expect(() => parsePinHash(badN)).toThrow(/PIN_HASH_PARAMS_OUT_OF_RANGE/);
  });

  it("rejects N above the defensive maximum", () => {
    const hugeN = valid.replace("N=16384", "N=8388608"); // 2^23, still power of two but far past MAX_N (2^20)
    expect(() => parsePinHash(hugeN)).toThrow(/PIN_HASH_PARAMS_OUT_OF_RANGE/);
  });

  it("rejects a parameter combination that would exceed the configured maxmem", () => {
    // 128 * N * r must stay <= 32 MiB; N=65536,r=8 => 128*65536*8 = 64 MiB, over budget.
    const overMaxmem = valid.replace("N=16384", "N=65536");
    expect(() => parsePinHash(overMaxmem)).toThrow(/PIN_HASH_PARAMS_OUT_OF_RANGE/);
  });

  it("rejects a salt shorter than the minimum length", () => {
    const shortSalt = Buffer.alloc(4, 1).toString("base64url");
    const withShortSalt = `scrypt$v=1$N=16384$r=8$p=5$keylen=64$${shortSalt}$${hash}`;
    expect(() => parsePinHash(withShortSalt)).toThrow(/PIN_HASH_PARAMS_OUT_OF_RANGE/);
  });

  it("rejects a hash whose length does not match keylen", () => {
    const shortHash = Buffer.alloc(32, 2).toString("base64url");
    const withShortHash = `scrypt$v=1$N=16384$r=8$p=5$keylen=64$${salt}$${shortHash}`;
    expect(() => parsePinHash(withShortHash)).toThrow(/PIN_HASH_PARAMS_OUT_OF_RANGE/);
  });

  it("rejects invalid base64url in the salt/hash fields", () => {
    const invalidB64 = `scrypt$v=1$N=16384$r=8$p=5$keylen=64$not base64!!$${hash}`;
    expect(() => parsePinHash(invalidB64)).toThrow();
  });
});

describe("needsRehash", () => {
  it("is false for a hash produced with the current target parameters", async () => {
    const stored = await hashPin("123456");
    expect(needsRehash(stored)).toBe(false);
  });

  it("is true for a hash with different parameters than the current target", () => {
    const salt = Buffer.alloc(16, 1).toString("base64url");
    const hash = Buffer.alloc(32, 2).toString("base64url");
    const oldParams = `scrypt$v=1$N=1024$r=8$p=1$keylen=32$${salt}$${hash}`;
    expect(needsRehash(oldParams)).toBe(true);
  });

  it("is true (fail-safe) for an unparseable stored value", () => {
    expect(needsRehash("garbage")).toBe(true);
  });
});
