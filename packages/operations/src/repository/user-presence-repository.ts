import type { Queryable } from "./types";

export type PresenceActorType = "STUDENT" | "STAFF" | "PLATFORM_ADMIN";

export interface UserPresenceRow {
  actorType: PresenceActorType;
  actorId: string;
  tenantId: string | null;
  lastSeenAt: Date;
}

interface DbRow {
  actor_type: PresenceActorType;
  actor_id: string;
  tenant_id: string | null;
  last_seen_at: Date;
}

function mapRow(row: DbRow): UserPresenceRow {
  return { actorType: row.actor_type, actorId: row.actor_id, tenantId: row.tenant_id, lastSeenAt: row.last_seen_at };
}

/**
 * Single row per (actorType, actorId), upserted on heartbeat (02_42
 * §14-16). Presence STATE (ONLINE/IDLE/OFFLINE) is never a column here --
 * it is always derived at read time from `lastSeenAt` against
 * configurable thresholds by `derivePresenceState` (../presence.ts).
 */
export class UserPresenceRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Server-side write coalescing (02_42 §16): only touches the row if the
   * previous `last_seen_at` is older than `coalesceWindowMs`, or the row
   * doesn't exist yet. Returns true if a write actually happened, so
   * callers/tests can verify coalescing suppressed the redundant write.
   */
  async heartbeat(input: {
    actorType: PresenceActorType;
    actorId: string;
    tenantId: string | null;
    coalesceWindowMs: number;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const result = await this.db.query(
      `INSERT INTO user_presence (actor_type, actor_id, tenant_id, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $5, $5)
       ON CONFLICT (actor_type, actor_id) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         tenant_id = EXCLUDED.tenant_id,
         updated_at = EXCLUDED.updated_at
       WHERE user_presence.last_seen_at < $5 - ($4 || ' milliseconds')::interval`,
      [input.actorType, input.actorId, input.tenantId, input.coalesceWindowMs, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countOnlineSince(actorType: PresenceActorType, since: Date, tenantId?: string | null): Promise<number> {
    const params: unknown[] = [actorType, since];
    let tenantClause = "";
    if (tenantId !== undefined) {
      params.push(tenantId);
      tenantClause = tenantId === null ? "AND tenant_id IS NULL" : `AND tenant_id = $${params.length}`;
    }
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM user_presence WHERE actor_type = $1 AND last_seen_at >= $2 ${tenantClause}`,
      params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async findByActor(actorType: PresenceActorType, actorId: string): Promise<UserPresenceRow | null> {
    const result = await this.db.query<DbRow>(
      `SELECT actor_type, actor_id, tenant_id, last_seen_at FROM user_presence WHERE actor_type = $1 AND actor_id = $2`,
      [actorType, actorId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
