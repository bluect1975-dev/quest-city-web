import { describe, expect, it } from "vitest";
import { derivePathState } from "./derive-path-state";

describe("derivePathState", () => {
  it("is COMPLETED when the student already completed it, regardless of GLPC availability", () => {
    expect(derivePathState("COMPLETED", "EFFECTIVE_AVAILABLE")).toBe("COMPLETED");
    expect(derivePathState("COMPLETED", "EFFECTIVE_UNAVAILABLE")).toBe("COMPLETED");
  });

  it("is LOCKED when GLPC says unavailable and the student has not completed it", () => {
    expect(derivePathState("NOT_STARTED", "EFFECTIVE_UNAVAILABLE")).toBe("LOCKED");
    expect(derivePathState("IN_PROGRESS", "EFFECTIVE_UNAVAILABLE")).toBe("LOCKED");
  });

  it("is CURRENT when available and an attempt is in progress", () => {
    expect(derivePathState("IN_PROGRESS", "EFFECTIVE_AVAILABLE")).toBe("CURRENT");
  });

  it("is AVAILABLE when available and not yet started", () => {
    expect(derivePathState("NOT_STARTED", "EFFECTIVE_AVAILABLE")).toBe("AVAILABLE");
  });
});
