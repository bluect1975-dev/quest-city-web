import type { Pool } from "pg";
import { UserPresenceRepository, type PresenceActorType } from "../repository/user-presence-repository";
import { derivePresenceState, DEFAULT_PRESENCE_THRESHOLDS, type PresenceThresholds } from "../presence";

/** Minimum interval between persisted heartbeat writes (02_42 §16) -- reference pilot value, configurable. */
export const DEFAULT_COALESCE_WINDOW_MS = 20_000;

export interface PresenceCounts {
  concurrentStudents: number;
  concurrentStaff: number;
  concurrentTotal: number;
}

export class PresenceService {
  constructor(
    private readonly pool: Pool,
    private readonly thresholds: PresenceThresholds = DEFAULT_PRESENCE_THRESHOLDS,
    private readonly coalesceWindowMs: number = DEFAULT_COALESCE_WINDOW_MS,
  ) {}

  /** Reused across all three session domains (student/staff/platform admin) -- one endpoint, not three (02_42 §15). */
  async heartbeat(actorType: PresenceActorType, actorId: string, tenantId: string | null): Promise<{ wrote: boolean }> {
    const repo = new UserPresenceRepository(this.pool);
    const wrote = await repo.heartbeat({ actorType, actorId, tenantId, coalesceWindowMs: this.coalesceWindowMs });
    return { wrote };
  }

  async concurrentCounts(tenantId?: string | null, now: Date = new Date()): Promise<PresenceCounts> {
    const repo = new UserPresenceRepository(this.pool);
    const since = new Date(now.getTime() - this.thresholds.onlineThresholdMs);
    const [students, staff] = await Promise.all([
      repo.countOnlineSince("STUDENT", since, tenantId),
      repo.countOnlineSince("STAFF", since, tenantId),
    ]);
    return { concurrentStudents: students, concurrentStaff: staff, concurrentTotal: students + staff };
  }

  async actorPresenceState(actorType: PresenceActorType, actorId: string, now: Date = new Date()) {
    const repo = new UserPresenceRepository(this.pool);
    const row = await repo.findByActor(actorType, actorId);
    return derivePresenceState(row?.lastSeenAt ?? null, now, this.thresholds);
  }
}
