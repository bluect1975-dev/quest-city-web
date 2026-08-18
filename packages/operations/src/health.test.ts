import { describe, expect, it } from "vitest";
import { aggregatePlatformHealth, type ServiceHealthInput } from "./health";

function entry(service: string, state: ServiceHealthInput["state"], staleSinceCheckedAt = false): ServiceHealthInput {
  return { service, state, staleSinceCheckedAt };
}

describe("aggregatePlatformHealth (02_42 §22, deterministic server-side rules)", () => {
  it("is HEALTHY when every critical service is HEALTHY", () => {
    expect(aggregatePlatformHealth([entry("API", "HEALTHY"), entry("POSTGRES", "HEALTHY")])).toBe("HEALTHY");
  });

  it("is CRITICAL if any critical required service is CRITICAL", () => {
    expect(aggregatePlatformHealth([entry("API", "HEALTHY"), entry("POSTGRES", "CRITICAL")])).toBe("CRITICAL");
  });

  it("is DEGRADED if a critical service is DEGRADED (never CRITICAL for a mere degradation)", () => {
    expect(aggregatePlatformHealth([entry("API", "DEGRADED"), entry("POSTGRES", "HEALTHY")])).toBe("DEGRADED");
  });

  it("is DEGRADED if a non-essential integration is CRITICAL, never escalated to platform CRITICAL", () => {
    expect(aggregatePlatformHealth([entry("API", "HEALTHY"), entry("TELEGRAM_INTEGRATION", "CRITICAL")])).toBe("DEGRADED");
  });

  it("is UNKNOWN when the majority of critical checks are stale, never silently HEALTHY", () => {
    expect(aggregatePlatformHealth([entry("API", "HEALTHY", true), entry("POSTGRES", "HEALTHY", true), entry("REVERSE_PROXY", "HEALTHY")])).toBe(
      "UNKNOWN",
    );
  });

  it("CRITICAL still wins over staleness when a majority of checks are fresh and one is CRITICAL", () => {
    expect(aggregatePlatformHealth([entry("API", "CRITICAL"), entry("POSTGRES", "HEALTHY"), entry("REVERSE_PROXY", "HEALTHY")])).toBe(
      "CRITICAL",
    );
  });

  it("is HEALTHY with no services reported (vacuous case)", () => {
    expect(aggregatePlatformHealth([])).toBe("HEALTHY");
  });
});
