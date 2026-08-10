import { describe, expect, it } from "vitest";
import { pickMotionProfile } from "./motion-profile";

describe("theme-level motion profile (07_26 v1.1 §13/§17.3)", () => {
  it("maps prefers-reduced-motion=true to REDUCED", () => {
    expect(pickMotionProfile(true)).toBe("REDUCED");
  });

  it("maps prefers-reduced-motion=false to STANDARD", () => {
    expect(pickMotionProfile(false)).toBe("STANDARD");
  });
});
