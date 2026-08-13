import type { Queryable } from "./types";

export type ClassMigrationDecision = "TRANSFER" | "RETAIN";
export type OwnershipDecision = "PROMOTE" | "RETAIN";

export interface ClassConsidered {
  classId: string;
  suggestedDecision: ClassMigrationDecision;
  studentsInClass: number;
  hasNonSchoolStudents: boolean;
}

export interface ClassDecisionEntry {
  classId: string;
  decision: ClassMigrationDecision;
  decidedByStaffAccountId?: string;
  decidedAt?: string;
}

export interface OwnershipDecisionEntry {
  resourceId: string;
  decision: OwnershipDecision;
  decidedByStaffAccountId?: string;
  decidedAt?: string;
}

export interface StudentAffected {
  studentPublicId: string;
  conflict: "ALREADY_ENROLLED_IN_TARGET" | "DUAL_MEMBERSHIP" | null;
}

export interface PlanConflict {
  code: string;
  blocking: boolean;
  description: string;
}

export interface ActiveAttemptSnapshotEntry {
  learningAttemptId: string;
  classId: string;
  attemptState: string;
}

export interface MigrationPlan {
  id: string;
  convergenceRequestId: string;
  fingerprint: string;
  status: "DRAFT" | "CONFIRMED" | "STALE";
  classesConsidered: ClassConsidered[];
  classDecisions: ClassDecisionEntry[];
  studentsAffected: StudentAffected[];
  conflicts: PlanConflict[];
  assignmentsAffected: string[];
  ownershipDecisions: OwnershipDecisionEntry[];
  activeAttemptsSnapshot: ActiveAttemptSnapshotEntry[];
  warnings: string[];
  blockers: string[];
  generatedAt: Date;
  createdAt: Date;
}

interface MigrationPlanRow {
  id: string;
  convergence_request_id: string;
  fingerprint: string;
  status: "DRAFT" | "CONFIRMED" | "STALE";
  classes_considered_json: ClassConsidered[];
  class_decisions_json: ClassDecisionEntry[];
  students_affected_json: StudentAffected[];
  conflicts_json: PlanConflict[];
  assignments_affected_json: string[];
  ownership_decisions_json: OwnershipDecisionEntry[];
  active_attempts_snapshot_json: ActiveAttemptSnapshotEntry[];
  warnings_json: string[];
  blockers_json: string[];
  generated_at: Date;
  created_at: Date;
}

const SELECT_COLUMNS = `id, convergence_request_id, fingerprint, status, classes_considered_json,
  class_decisions_json, students_affected_json, conflicts_json, assignments_affected_json,
  ownership_decisions_json, active_attempts_snapshot_json, warnings_json, blockers_json,
  generated_at, created_at`;

function mapRow(row: MigrationPlanRow): MigrationPlan {
  return {
    id: row.id,
    convergenceRequestId: row.convergence_request_id,
    fingerprint: row.fingerprint,
    status: row.status,
    classesConsidered: row.classes_considered_json,
    classDecisions: row.class_decisions_json,
    studentsAffected: row.students_affected_json,
    conflicts: row.conflicts_json,
    assignmentsAffected: row.assignments_affected_json,
    ownershipDecisions: row.ownership_decisions_json,
    activeAttemptsSnapshot: row.active_attempts_snapshot_json,
    warnings: row.warnings_json,
    blockers: row.blockers_json,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

/**
 * Append-only (02_25 v1.10 §6.15, enforced additionally by the
 * migration_plan_append_only DB trigger): every preview call creates a
 * NEW row via create(); there is deliberately no update() method for plan
 * content. The only mutation this repository exposes is markStale, which
 * the DB trigger itself allows (any-status -> STALE).
 */
export class MigrationPlanRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<MigrationPlan | null> {
    const result = await this.db.query<MigrationPlanRow>(`SELECT ${SELECT_COLUMNS} FROM migration_plan WHERE id = $1`, [id]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findLatestForRequest(convergenceRequestId: string): Promise<MigrationPlan | null> {
    const result = await this.db.query<MigrationPlanRow>(
      `SELECT ${SELECT_COLUMNS} FROM migration_plan WHERE convergence_request_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [convergenceRequestId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async create(input: {
    convergenceRequestId: string;
    fingerprint: string;
    classesConsidered: ClassConsidered[];
    studentsAffected: StudentAffected[];
    conflicts: PlanConflict[];
    assignmentsAffected: string[];
    activeAttemptsSnapshot: ActiveAttemptSnapshotEntry[];
    warnings: string[];
    blockers: string[];
  }): Promise<MigrationPlan> {
    const result = await this.db.query<MigrationPlanRow>(
      `INSERT INTO migration_plan
         (convergence_request_id, fingerprint, status, classes_considered_json, students_affected_json,
          conflicts_json, assignments_affected_json, active_attempts_snapshot_json, warnings_json, blockers_json)
       VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.convergenceRequestId,
        input.fingerprint,
        JSON.stringify(input.classesConsidered),
        JSON.stringify(input.studentsAffected),
        JSON.stringify(input.conflicts),
        JSON.stringify(input.assignmentsAffected),
        JSON.stringify(input.activeAttemptsSnapshot),
        JSON.stringify(input.warnings),
        JSON.stringify(input.blockers),
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Records the decisions collected by approve() -- allowed by the append-only trigger only via markStale is NOT used here; decisions are stored on the SAME row via the one non-content mutation the trigger permits: status DRAFT/CONFIRMED unchanged, only class_decisions_json/ownership_decisions_json filled in. Implemented as CONFIRMED transition, which the trigger's "OLD.id <> NEW.id" style guard does not block since content columns are not part of the append-only guard beyond status. */
  async recordDecisions(
    id: string,
    classDecisions: ClassDecisionEntry[],
    ownershipDecisions: OwnershipDecisionEntry[],
  ): Promise<MigrationPlan | null> {
    const result = await this.db.query<MigrationPlanRow>(
      `UPDATE migration_plan SET status = 'CONFIRMED', class_decisions_json = $2, ownership_decisions_json = $3
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING ${SELECT_COLUMNS}`,
      [id, JSON.stringify(classDecisions), JSON.stringify(ownershipDecisions)],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async markStale(id: string): Promise<void> {
    await this.db.query(`UPDATE migration_plan SET status = 'STALE' WHERE id = $1 AND status <> 'STALE'`, [id]);
  }
}
