import { beforeAll, describe, expect, it } from "vitest";

/**
 * Integration test for WEB-M0 deliverable 22 ("integration test degli
 * health endpoint") and the acceptance criteria that student-web, dashboard
 * and api all respond correctly through the reverse proxy. Requires the
 * docker-compose environment to be running:
 *
 *   docker compose -f infrastructure/deployment/docker-compose.yml up -d --build
 *   HEALTH_BASE_URL=http://localhost:8080 pnpm run test:integration
 */
const BASE_URL = process.env.HEALTH_BASE_URL ?? "http://localhost:8080";

async function waitForOk(url: string, maxAttempts = 20, delayMs = 1000): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`Received status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError;
}

describe("WEB-M0 health endpoints and routes (via reverse proxy)", () => {
  beforeAll(async () => {
    await waitForOk(`${BASE_URL}/api/health/live`);
  });

  it("GET /api/health/live returns 200 and status ok", async () => {
    const response = await fetch(`${BASE_URL}/api/health/live`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.check).toBe("live");
  });

  it("GET /api/health/ready returns 200 with database reachable", async () => {
    const response = await fetch(`${BASE_URL}/api/health/ready`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("reachable");
  });

  it("propagates a correlation ID end-to-end through the reverse proxy", async () => {
    const correlationId = "test-correlation-id-12345";
    const response = await fetch(`${BASE_URL}/api/health/live`, {
      headers: { "x-correlation-id": correlationId },
    });
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
  });

  it("GET /w (student-web) responds successfully", async () => {
    const response = await fetch(`${BASE_URL}/w`, { redirect: "follow" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Quest City");
  });

  it("GET /dashboard responds successfully", async () => {
    const response = await fetch(`${BASE_URL}/dashboard`, { redirect: "follow" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Quest City Dashboard");
  });
});
