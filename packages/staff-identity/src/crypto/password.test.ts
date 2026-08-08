import { describe, expect, it } from "vitest";
import { formatPasswordHash, hashPassword, needsRehash, parsePasswordHash, PASSWORD_SCRYPT_PARAMS, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("never throws on a malformed stored hash — returns false", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("round-trips through format/parse", async () => {
    const hash = await hashPassword("s3cr3t");
    const parsed = parsePasswordHash(hash);
    expect(parsed.params).toEqual(PASSWORD_SCRYPT_PARAMS);
    const reformatted = formatPasswordHash(parsed.params, parsed.salt, parsed.hash);
    expect(reformatted).toBe(hash);
  });

  it("flags a hash with different params as needing rehash", () => {
    const oldParams = { n: 16384, r: 8, p: 1, keylen: 64 };
    const hash = formatPasswordHash(oldParams, Buffer.alloc(16, 1), Buffer.alloc(64, 2));
    expect(needsRehash(hash)).toBe(true);
  });

  it("does not flag a freshly hashed password as needing rehash", async () => {
    const hash = await hashPassword("s3cr3t");
    expect(needsRehash(hash)).toBe(false);
  });

  it("rejects a malformed hash in parsePasswordHash", () => {
    expect(() => parsePasswordHash("garbage")).toThrow();
  });
});
