import type { ServiceHealthState } from "./repository/service-health-state-repository";

/** The five services 07_06 §16 names as subject to pre-traffic health checks (02_42 §22). */
export const CRITICAL_SERVICES = ["API", "POSTGRES", "REVERSE_PROXY", "STUDENT_WEB", "DASHBOARD"] as const;
export type CriticalService = (typeof CRITICAL_SERVICES)[number];

export interface ServiceHealthInput {
  service: string;
  state: ServiceHealthState;
  staleSinceCheckedAt: boolean;
}

/**
 * Deterministic global-health aggregation (02_42 §22), never left to the
 * client:
 *   - CRITICAL if any critical required service is CRITICAL
 *   - UNKNOWN if the majority of required checks are stale
 *   - DEGRADED if a critical service is DEGRADED, or a non-essential
 *     integration is CRITICAL
 *   - HEALTHY otherwise
 */
export function aggregatePlatformHealth(services: ServiceHealthInput[]): ServiceHealthState {
  const criticalEntries = services.filter((entry) => (CRITICAL_SERVICES as readonly string[]).includes(entry.service));

  const staleCount = criticalEntries.filter((entry) => entry.staleSinceCheckedAt).length;
  if (criticalEntries.length > 0 && staleCount > criticalEntries.length / 2) return "UNKNOWN";

  if (criticalEntries.some((entry) => entry.state === "CRITICAL")) return "CRITICAL";

  const nonEssentialCritical = services.some(
    (entry) => !(CRITICAL_SERVICES as readonly string[]).includes(entry.service) && entry.state === "CRITICAL",
  );
  const criticalDegraded = criticalEntries.some((entry) => entry.state === "DEGRADED");
  if (criticalDegraded || nonEssentialCritical) return "DEGRADED";

  return "HEALTHY";
}
