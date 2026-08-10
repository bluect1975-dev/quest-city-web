import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAttempt } from "./student-api-client";

/**
 * M06 Non-Interactive Attempt Lifecycle: regression guard for a real bug
 * found via the INTRO_HOOK browser walkthrough — `completeAttempt` used to
 * coerce a missing `finalClientSequence` to `0`, which made a false claim
 * ("an action with clientSequence 0 exists") for an attempt that never
 * submitted any semantic action, tripping `checkFinalClientSequence`
 * server-side into rejecting completion with `MISSING_ACTION`.
 */
describe("completeAttempt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits finalClientSequence from the request body entirely when undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { attemptId: "attempt-1", completionStatus: "CONSOLIDATED" }, meta: { api_version: "v1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await completeAttempt("attempt-1", undefined, "csrf-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("includes finalClientSequence in the request body when a real value is known", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { attemptId: "attempt-1", completionStatus: "CONSOLIDATED" }, meta: { api_version: "v1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await completeAttempt("attempt-1", 3, "csrf-token");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ finalClientSequence: 3 });
  });
});
