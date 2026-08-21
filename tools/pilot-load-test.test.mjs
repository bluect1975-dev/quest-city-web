import { describe, it, expect } from "vitest";
import { Metrics, percentile, extractSetCookie } from "./pilot-load-test.mjs";

describe("percentile", () => {
  it("returns null for an empty array", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("returns the single value for a one-element array at any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("computes p50/p95/p99 on a sorted 100-element array", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
  });
});

describe("Metrics", () => {
  it("summarizes requests, success rate, error count and status breakdown", () => {
    const metrics = new Metrics();
    metrics.record("login", 200, 100, true);
    metrics.record("login", 200, 150, true);
    metrics.record("login", 429, 50, true);
    metrics.record("login", 500, 20, false);

    const summary = metrics.summaryFor();
    expect(summary.requests).toBe(4);
    expect(summary.errorCount).toBe(1);
    expect(summary.successRate).toBe(0.75);
    expect(summary.statusBreakdown).toEqual({ "200": 2, "429": 1, "500": 1 });
    expect(summary.minMs).toBe(20);
    expect(summary.maxMs).toBe(150);
  });

  it("filters by name via summaryFor's predicate", () => {
    const metrics = new Metrics();
    metrics.record("login", 200, 10, true);
    metrics.record("progress", 200, 20, true);

    expect(metrics.summaryFor((s) => s.name === "login").requests).toBe(1);
    expect(metrics.summaryFor((s) => s.name === "progress").requests).toBe(1);
  });

  it("returns null percentiles when there are no samples", () => {
    const metrics = new Metrics();
    const summary = metrics.summaryFor();
    expect(summary.requests).toBe(0);
    expect(summary.successRate).toBeNull();
    expect(summary.p50).toBeNull();
  });
});

describe("extractSetCookie", () => {
  it("returns null when headers has no set-cookie", () => {
    const headers = new Headers();
    expect(extractSetCookie(headers)).toBeNull();
  });

  it("extracts and joins name=value pairs from getSetCookie(), dropping attributes", () => {
    const headers = {
      getSetCookie: () => ["qc_web_session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax"],
    };
    expect(extractSetCookie(headers)).toBe("qc_web_session=abc123");
  });

  it("joins multiple cookies with '; '", () => {
    const headers = {
      getSetCookie: () => ["a=1; Path=/", "b=2; Path=/"],
    };
    expect(extractSetCookie(headers)).toBe("a=1; b=2");
  });
});
