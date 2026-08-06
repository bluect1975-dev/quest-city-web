import { describe, expect, it } from "vitest";
import { CSRF_TOKEN_BYTES, SESSION_TOKEN_BYTES, generateToken, hashToken, verifyTokenHash } from "./token";

describe("generateToken", () => {
  it("generates a token whose decoded length matches the requested byte length", () => {
    const token = generateToken(SESSION_TOKEN_BYTES);
    expect(Buffer.from(token, "base64url").length).toBe(SESSION_TOKEN_BYTES);
  });

  it("generates distinct tokens on successive calls", () => {
    const a = generateToken(CSRF_TOKEN_BYTES);
    const b = generateToken(CSRF_TOKEN_BYTES);
    expect(a).not.toBe(b);
  });
});

describe("hashToken / verifyTokenHash", () => {
  it("round-trips a correct token", () => {
    const token = generateToken(SESSION_TOKEN_BYTES);
    const hash = hashToken(token);
    expect(verifyTokenHash(token, hash)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = generateToken(SESSION_TOKEN_BYTES);
    const hash = hashToken(token);
    expect(verifyTokenHash(`${token}x`, hash)).toBe(false);
  });

  it("rejects a well-formed but wrong token", () => {
    const hash = hashToken(generateToken(SESSION_TOKEN_BYTES));
    const other = generateToken(SESSION_TOKEN_BYTES);
    expect(verifyTokenHash(other, hash)).toBe(false);
  });

  it("treats a malformed stored hash as a non-match rather than throwing", () => {
    expect(verifyTokenHash("anything", "not valid base64url!!")).toBe(false);
  });

  it("hashToken is deterministic for the same input", () => {
    const token = generateToken(SESSION_TOKEN_BYTES);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
