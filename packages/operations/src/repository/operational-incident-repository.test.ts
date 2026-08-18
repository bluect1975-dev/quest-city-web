import { describe, expect, it } from "vitest";
import { buildIncidentDedupKey } from "./operational-incident-repository";

describe("buildIncidentDedupKey (02_42 §27, dedup key = (type, service, source))", () => {
  it("is deterministic and order-stable", () => {
    expect(buildIncidentDedupKey("API_DOWN", "API", "APPLICATION")).toBe(buildIncidentDedupKey("API_DOWN", "API", "APPLICATION"));
  });

  it("differs when any of the three components differ", () => {
    const base = buildIncidentDedupKey("API_DOWN", "API", "APPLICATION");
    expect(buildIncidentDedupKey("POSTGRES_DOWN", "API", "APPLICATION")).not.toBe(base);
    expect(buildIncidentDedupKey("API_DOWN", "POSTGRES", "APPLICATION")).not.toBe(base);
    expect(buildIncidentDedupKey("API_DOWN", "API", "DATABASE")).not.toBe(base);
  });
});
