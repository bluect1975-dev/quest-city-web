import type { Pool } from "pg";
import { OperationsCountersRepository } from "../repository/operations-counters-repository";
import { ServiceHealthStateRepository } from "../repository/service-health-state-repository";
import { OperationalIncidentRepository } from "../repository/operational-incident-repository";
import { PresenceService } from "./presence-service";
import { aggregatePlatformHealth, CRITICAL_SERVICES } from "../health";

const STALE_AFTER_MS = 5 * 60 * 1000;

/** Composes overview KPIs (02_42 §39) -- a read-only aggregation, never a mutation, always batched queries. */
export class OverviewService {
  constructor(private readonly pool: Pool) {}

  async getOverview() {
    const counters = new OperationsCountersRepository(this.pool);
    const healthRepo = new ServiceHealthStateRepository(this.pool);
    const incidents = new OperationalIncidentRepository(this.pool);
    const presence = new PresenceService(this.pool);

    const [tenantCounts, staffRoles, uniqueStaff, studentCounts, activeAttempts, openIncidents, latestHealth, presenceCounts] =
      await Promise.all([
        counters.tenantCounts(),
        counters.staffCountsByRole(),
        counters.totalUniqueStaffHumans(),
        counters.studentCounts(),
        counters.activeLearningAttempts(),
        incidents.countOpen(),
        healthRepo.listLatestPerService(),
        presence.concurrentCounts(),
      ]);

    const now = Date.now();
    const platformStatus = aggregatePlatformHealth(
      latestHealth
        .filter((entry) => (CRITICAL_SERVICES as readonly string[]).includes(entry.service))
        .map((entry) => ({
          service: entry.service,
          state: entry.state,
          staleSinceCheckedAt: now - entry.checkedAt.getTime() > STALE_AFTER_MS,
        })),
    );

    return {
      platformStatus,
      kpi: {
        schoolsTotal: tenantCounts.schoolsTotal,
        schoolsActive: tenantCounts.schoolsActive,
        schoolsSuspended: tenantCounts.schoolsSuspended,
        independentEducatorsTotal: tenantCounts.independentEducatorsTotal,
        classesTotal: tenantCounts.classesTotal,
        staffByRole: staffRoles,
        staffUniqueHumansTotal: uniqueStaff,
        studentsEnrolled: studentCounts.studentsEnrolled,
        studentsOnlineNow: presenceCounts.concurrentStudents,
        staffOnlineNow: presenceCounts.concurrentStaff,
        activeLearningAttempts: activeAttempts,
      },
      openIncidents,
      lastBackup: { status: "NOT_CONFIGURED" as const },
    };
  }
}
