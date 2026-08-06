import { describe, expect, it } from "vitest";
import { isMigrationFile } from "./migration-filename.mjs";

describe("isMigrationFile", () => {
  it("accepts a well-formed migration filename", () => {
    expect(isMigrationFile("0001_init_extensions.sql")).toBe(true);
  });

  it("rejects a rollback filename (excluded from forward application)", () => {
    expect(isMigrationFile("0001_init_extensions.rollback.sql")).toBe(false);
  });

  it("rejects a filename without a four-digit sequence prefix", () => {
    expect(isMigrationFile("init.sql")).toBe(false);
  });

  it("rejects README.md", () => {
    expect(isMigrationFile("README.md")).toBe(false);
  });
});
