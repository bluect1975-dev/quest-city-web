import { describe, expect, it, vi } from "vitest";
import { createLogger, newCorrelationId } from "./logger";

describe("structured logger", () => {
  it("generates a correlation id when none is provided", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("emits a JSON line containing level, message and correlationId", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger("fixed-correlation-id");
    const entry = logger.info("health check ok", { route: "/health/live" });
    expect(entry.correlationId).toBe("fixed-correlation-id");
    expect(entry.level).toBe("info");
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(logged.correlationId).toBe("fixed-correlation-id");
    spy.mockRestore();
  });
});
