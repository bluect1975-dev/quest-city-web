import { describe, expect, it } from "vitest";
import {
  coversRequiredCapabilities,
  isAxisAValue,
  satisfiesAxisBRequirement,
} from "./capability-contract";
import type { AxisBProfile } from "./types";

describe("Axis A — interaction/activity capability coverage", () => {
  it("accepts every canonical Axis A value (07_08 §9 vocabulary, unchanged)", () => {
    for (const v of [
      "TEXT_INPUT",
      "NUMERIC_INPUT",
      "OPTION_SELECTION",
      "DRAG_DROP",
      "ORDERING",
      "MATCHING",
      "GRAPH_PLOT",
      "OBJECT_MANIPULATION_2D",
      "OBJECT_MANIPULATION_3D",
      "AUDIO_PLAYBACK",
      "VOICE_INPUT",
      "REALTIME_MULTIUSER",
      "ANIMATED_SCENE",
      "OFFLINE_BUFFERED_ACTIONS",
    ]) {
      expect(isAxisAValue(v)).toBe(true);
    }
  });

  it("rejects a non-canonical value — no local Axis A extension permitted", () => {
    expect(isAxisAValue("SCROLL_WHEEL_INPUT")).toBe(false);
  });

  it("covers when every requested capability is declared required or optional", () => {
    const covered = coversRequiredCapabilities(["DRAG_DROP"], {
      required: ["DRAG_DROP"],
      optional: ["ANIMATED_SCENE"],
    });
    expect(covered).toBe(true);
  });

  it("does not cover when a requested capability is declared nowhere", () => {
    const covered = coversRequiredCapabilities(["DRAG_DROP", "VOICE_INPUT"], {
      required: ["DRAG_DROP"],
      optional: ["ANIMATED_SCENE"],
    });
    expect(covered).toBe(false);
  });
});

describe("Axis B — device/runtime presentation, kept distinct from Axis A", () => {
  const profile: AxisBProfile = {
    profileId: "TEST-FIXTURE-PROFILE",
    input: ["pointer", "keyboard"],
    rendering: ["html", "svg"],
    reducedMotion: true,
    viewportClass: "large",
  };

  it("satisfies a requirement whose input/rendering intersect the profile", () => {
    expect(
      satisfiesAxisBRequirement(profile, { input: ["touch", "keyboard"], rendering: ["svg"] }),
    ).toBe(true);
  });

  it("fails a requirement whose input needs are entirely absent from the profile", () => {
    expect(satisfiesAxisBRequirement(profile, { input: ["assistive"] })).toBe(false);
  });

  it("fails a requirement whose rendering needs are entirely absent from the profile", () => {
    expect(satisfiesAxisBRequirement(profile, { rendering: ["canvas2d"] })).toBe(false);
  });

  it("enforces reducedMotionRequired against the profile's actual flag", () => {
    expect(satisfiesAxisBRequirement(profile, { reducedMotionRequired: true })).toBe(true);
    expect(
      satisfiesAxisBRequirement({ ...profile, reducedMotion: false }, { reducedMotionRequired: true }),
    ).toBe(false);
  });
});
