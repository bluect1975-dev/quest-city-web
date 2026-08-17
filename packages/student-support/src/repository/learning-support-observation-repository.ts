import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";
import type { SupportType } from "./learning-support-event-repository";

export type ObservationActorRole = "ASACOM" | "SUPPORT_TEACHER";

export interface LearningSupportObservation {
  id: string;
  publicId: string;
  tenantId: string;
  studentProfileId: string;
  supportStudentAssignmentId: string;
  actorStaffAccountId: string;
  actorRole: ObservationActorRole;
  observedAt: Date;
  category: SupportType | null;
  noteStructuredRef: string | null;
  supersededById: string | null;
  createdAt: Date;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  student_profile_id: string;
  support_student_assignment_id: string;
  actor_staff_account_id: string;
  actor_role: ObservationActorRole;
  observed_at: Date;
  category: SupportType | null;
  note_structured_ref: string | null;
  superseded_by_id: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, student_profile_id, support_student_assignment_id, actor_staff_account_id,
  actor_role, observed_at, category, note_structured_ref, superseded_by_id, created_at`;

function mapRow(row: Row): LearningSupportObservation {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    studentProfileId: row.student_profile_id,
    supportStudentAssignmentId: row.support_student_assignment_id,
    actorStaffAccountId: row.actor_staff_account_id,
    actorRole: row.actor_role,
    observedAt: row.observed_at,
    category: row.category,
    noteStructuredRef: row.note_structured_ref,
    supersededById: row.superseded_by_id,
    createdAt: row.created_at,
  };
}

/**
 * `learning_support_observation` (02_25 v1.12 §6.16.2, 02_39 §10) --
 * post-session, append-only, corrected only via `superseded_by_id`
 * (never a destructive UPDATE of note content). `TEACHER` is never an
 * actor (§41) -- enforced at the service layer, the DB CHECK on
 * `actor_role` already excludes it structurally.
 */
export class LearningSupportObservationRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<LearningSupportObservation | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_support_observation WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByPublicId(publicId: string, tenantId: string): Promise<LearningSupportObservation | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_support_observation WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * `GET /students/{studentPublicId}/support-observations` (02_26 v1.17
   * §38.1). `includeSuperseded=false` (default) returns only entries with
   * no `superseded_by_id` (the current entry of each correction chain);
   * `true` returns the full append-only history. `historyStatus`/
   * `supersedesId` are computed by the caller (service layer), never
   * persisted -- this repository returns raw rows only.
   */
  async findByStudent(
    studentProfileId: string,
    tenantId: string,
    filter: { category?: SupportType | undefined; includeSuperseded: boolean },
    pagination: { limit: number; offset: number },
  ): Promise<LearningSupportObservation[]> {
    const conditions: string[] = ["student_profile_id = $1", "tenant_id = $2"];
    const params: unknown[] = [studentProfileId, tenantId];
    if (filter.category) {
      params.push(filter.category);
      conditions.push(`category = $${params.length}`);
    }
    if (!filter.includeSuperseded) {
      conditions.push(`superseded_by_id IS NULL`);
    }
    params.push(pagination.limit, pagination.offset);
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_support_observation
       WHERE ${conditions.join(" AND ")}
       ORDER BY observed_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(mapRow);
  }

  async create(input: {
    tenantId: string;
    studentProfileId: string;
    supportStudentAssignmentId: string;
    actorStaffAccountId: string;
    actorRole: ObservationActorRole;
    observedAt?: Date;
    category?: SupportType | null | undefined;
    noteStructuredRef?: string | null;
  }): Promise<LearningSupportObservation> {
    const publicId = `lso_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO learning_support_observation
         (public_id, tenant_id, student_profile_id, support_student_assignment_id, actor_staff_account_id, actor_role,
          observed_at, category, note_structured_ref)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [
        publicId,
        input.tenantId,
        input.studentProfileId,
        input.supportStudentAssignmentId,
        input.actorStaffAccountId,
        input.actorRole,
        input.observedAt ?? null,
        input.category ?? null,
        input.noteStructuredRef ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Marks `original` as superseded by the newly-created row's id -- the original row itself is never otherwise mutated. */
  async markSuperseded(id: string, tenantId: string, supersededById: string): Promise<void> {
    await this.db.query(`UPDATE learning_support_observation SET superseded_by_id = $3 WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
      supersededById,
    ]);
  }
}
