import { describe, expect, it } from "vitest";
import { derivePresenceState, DEFAULT_PRESENCE_THRESHOLDS } from "./presence";

describe("derivePresenceState (02_42 §14)", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");

  it("returns OFFLINE when no presence row exists", () => {
    expect(derivePresenceState(null, now)).toBe("OFFLINE");
  });

  it("returns ONLINE within the online threshold", () => {
    const lastSeenAt = new Date(now.getTime() - 60_000);
    expect(derivePresenceState(lastSeenAt, now)).toBe("ONLINE");
  });

  it("returns ONLINE exactly at the online threshold boundary (inclusive)", () => {
    const lastSeenAt = new Date(now.getTime() - DEFAULT_PRESENCE_THRESHOLDS.onlineThresholdMs);
    expect(derivePresenceState(lastSeenAt, now)).toBe("ONLINE");
  });

  it("returns IDLE just past the online threshold", () => {
    const lastSeenAt = new Date(now.getTime() - DEFAULT_PRESENCE_THRESHOLDS.onlineThresholdMs - 1);
    expect(derivePresenceState(lastSeenAt, now)).toBe("IDLE");
  });

  it("returns IDLE exactly at the idle threshold boundary (inclusive)", () => {
    const lastSeenAt = new Date(now.getTime() - DEFAULT_PRESENCE_THRESHOLDS.idleThresholdMs);
    expect(derivePresenceState(lastSeenAt, now)).toBe("IDLE");
  });

  it("returns OFFLINE past the idle threshold", () => {
    const lastSeenAt = new Date(now.getTime() - DEFAULT_PRESENCE_THRESHOLDS.idleThresholdMs - 1);
    expect(derivePresenceState(lastSeenAt, now)).toBe("OFFLINE");
  });

  it("treats clock skew (lastSeenAt in the future) as ONLINE, never negative age", () => {
    const lastSeenAt = new Date(now.getTime() + 5_000);
    expect(derivePresenceState(lastSeenAt, now)).toBe("ONLINE");
  });

  it("respects custom configurable thresholds (never hardcoded elsewhere)", () => {
    const customThresholds = { onlineThresholdMs: 5_000, idleThresholdMs: 10_000 };
    const lastSeenAt = new Date(now.getTime() - 7_000);
    expect(derivePresenceState(lastSeenAt, now, customThresholds)).toBe("IDLE");
  });
});
