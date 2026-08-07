import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLASS_CODE_LENGTH,
  CLASS_CODE_PEPPER_MIN_BYTES,
  ClassCodePepperError,
  GENERATED_PIN_LENGTH,
  compareClassCodeHash,
  decodeClassCodePepper,
  generateClassCode,
  generatePin,
  hashClassCode,
} from "./class-code";

describe("generateClassCode", () => {
  it("generates a code of the default length", () => {
    expect(generateClassCode()).toHaveLength(CLASS_CODE_LENGTH);
  });

  it("respects a custom length within the OpenAPI v1.3 bound (4-32)", () => {
    expect(generateClassCode(12)).toHaveLength(12);
  });

  it("never contains visually ambiguous characters (0/O, 1/I)", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateClassCode(16);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("generates distinct codes on successive calls", () => {
    const a = generateClassCode();
    const b = generateClassCode();
    expect(a).not.toBe(b);
  });
});

describe("generatePin", () => {
  it("generates a 6-digit PIN by default (WEB-M1 baseline)", () => {
    const pin = generatePin();
    expect(pin).toHaveLength(GENERATED_PIN_LENGTH);
    expect(pin).toMatch(/^[0-9]+$/);
  });

  it("respects a custom length", () => {
    expect(generatePin(8)).toHaveLength(8);
  });
});

describe("decodeClassCodePepper (WEB-M1 Fase 2 correction #1)", () => {
  const validPepperB64 = randomBytes(32).toString("base64");

  it("decodes a valid base64 pepper of exactly the minimum length", () => {
    const pepper = decodeClassCodePepper(validPepperB64);
    expect(pepper.length).toBe(CLASS_CODE_PEPPER_MIN_BYTES);
  });

  it("decodes a longer-than-minimum pepper without truncating it", () => {
    const longer = randomBytes(48).toString("base64");
    expect(decodeClassCodePepper(longer).length).toBe(48);
  });

  it("throws (never with a default) when the pepper is undefined", () => {
    expect(() => decodeClassCodePepper(undefined)).toThrow(ClassCodePepperError);
  });

  it("throws when the pepper is an empty string", () => {
    expect(() => decodeClassCodePepper("")).toThrow(ClassCodePepperError);
  });

  it("throws when the decoded pepper is shorter than 32 bytes", () => {
    const tooShort = randomBytes(16).toString("base64");
    expect(() => decodeClassCodePepper(tooShort)).toThrow(/at least 32 bytes/);
  });

  it("never includes the raw pepper value in its error message", () => {
    const tooShort = randomBytes(16).toString("base64");
    try {
      decodeClassCodePepper(tooShort);
      throw new Error("expected decodeClassCodePepper to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(tooShort);
    }
  });
});

describe("hashClassCode (HMAC-SHA-256, WEB-M1 Fase 2 correction #1)", () => {
  const pepperA = randomBytes(32);
  const pepperB = randomBytes(32);

  it("same code + same key -> same digest (deterministic lookup)", () => {
    const a = hashClassCode("ABCD1234", pepperA);
    const b = hashClassCode("ABCD1234", pepperA);
    expect(a).toBe(b);
  });

  it("same code + different key -> different digest", () => {
    const a = hashClassCode("ABCD1234", pepperA);
    const b = hashClassCode("ABCD1234", pepperB);
    expect(a).not.toBe(b);
  });

  it("different code + same key -> different digest", () => {
    const a = hashClassCode("ABCD1234", pepperA);
    const b = hashClassCode("WXYZ9876", pepperA);
    expect(a).not.toBe(b);
  });

  it("is not plain SHA-256 of the code — the key changes the output for the same input", () => {
    // If this were unkeyed SHA-256, pepperA/pepperB would never matter.
    const withA = hashClassCode("SAMECODE", pepperA);
    const withB = hashClassCode("SAMECODE", pepperB);
    expect(withA).not.toBe(withB);
  });

  it("supports a deterministic lookup: hashing the normalized code again finds the same stored digest", () => {
    const stored = hashClassCode("LOOKUPME", pepperA);
    const recomputed = hashClassCode("LOOKUPME", pepperA);
    expect(compareClassCodeHash(recomputed, stored)).toBe(true);
  });

  it("compareClassCodeHash rejects a mismatched digest", () => {
    const stored = hashClassCode("LOOKUPME", pepperA);
    const wrong = hashClassCode("OTHERCODE", pepperA);
    expect(compareClassCodeHash(wrong, stored)).toBe(false);
  });

  it("compareClassCodeHash treats a malformed stored digest as a non-match rather than throwing", () => {
    const computed = hashClassCode("LOOKUPME", pepperA);
    expect(compareClassCodeHash(computed, "not valid base64url!!")).toBe(false);
  });
});
