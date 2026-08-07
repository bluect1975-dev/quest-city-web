import { describe, expect, it } from "vitest";
import { normalizeAlias, normalizeClassCode } from "./normalize";

describe("normalizeAlias", () => {
  it("trims whitespace", () => {
    expect(normalizeAlias("  marco  ")).toBe("marco");
  });

  it("lowercases", () => {
    expect(normalizeAlias("Marco.R")).toBe("marco.r");
  });

  it("produces the same normalized form for aliases differing only by case/whitespace", () => {
    expect(normalizeAlias("  Marco.R ")).toBe(normalizeAlias("marco.r"));
  });

  it("rejects on empty input at the DB layer, but here just normalizes to empty", () => {
    expect(normalizeAlias("   ")).toBe("");
  });
});

describe("normalizeClassCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeClassCode("  ab3dEfGh ")).toBe("AB3DEFGH");
  });

  it("produces the same normalized form regardless of the case typed by the student", () => {
    expect(normalizeClassCode("ab3dEfGh")).toBe(normalizeClassCode("AB3DEFGH"));
  });
});
