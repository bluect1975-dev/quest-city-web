import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";

export type SupportActorRole = "ASACOM" | "TEACHER" | "SUPPORT_TEACHER";
export type SupportType =
  | "COMMUNICATION_SUPPORT"
  | "COMPREHENSION_SUPPORT"
  | "ATTENTION_SUPPORT"
  | "MOTOR_INTERACTION_SUPPORT"
  | "NAVIGATION_SUPPORT"
  | "EMOTIONAL_REGULATION_SUPPORT"
  | "TASK_ORGANIZATION_SUPPORT"
  | "ACCESSIBILITY_FACILITATION"
  | "OTHER_STRUCTURED";
export type SupportIntensity = "NONE" | "MINIMAL" | "MODERATE" | "SIGNIFICANT";

export interface LearningSupportEvent {
  id: string;
  publicId: string;
  tenantId: string;
  learningAttemptId: string;
  studentProfileId: string;
  actorStaffAccountId: string;
  actorRole: SupportActorRole;
  supportType: SupportType;
  intensity: SupportIntensity;
  occurredAt: Date;
  durationSeconds: number | null;
  noteStructuredRef: string | null;
  createdAt: Date;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  learning_attempt_id: string;
  student_profile_id: string;
  actor_staff_account_id: string;
  actor_role: SupportActorRole;
  support_type: SupportType;
  intensity: SupportIntensity;
  occurred_at: Date;
  duration_seconds: number | null;
  note_structured_ref: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, learning_attempt_id, student_profile_id, actor_staff_account_id,
  actor_role, support_type, intensity, occurred_at, duration_seconds, note_structured_ref, created_at`;

function mapRow(row: Row): LearningSupportEvent {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    learningAttemptId: row.learning_attempt_id,
    studentProfileId: row.student_profile_id,
    actorStaffAccountId: row.actor_staff_account_id,
    actorRole: row.actor_role,
    supportType: row.support_type,
    intensity: row.intensity,
    occurredAt: row.occurred_at,
    durationSeconds: row.duration_seconds,
    noteStructuredRef: row.note_structured_ref,
    createdAt: row.created_at,
  };
}

/**
 * `learning_support_event` (02_25 v1.12 §6.16.2, 02_39 §9) -- HUMAN_SUPPORT
 * axis, append-only. No update/delete method exists on this repository by
 * design: a correction is always a new row (02_39 §9). Never alters
 * `learning_attempt.outcome`/`attemptState`/`completionStatus`.
 */
export class LearningSupportEventRepository {
  constructor(private readonly db: Queryable) {}

  async findByPublicId(publicId: string, tenantId: string): Promise<LearningSupportEvent | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_support_event WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** `GET /students/{studentPublicId}/support-events` (02_26 v1.16 §37.4) -- one shared endpoint, not one per role. */
  async findByStudent(studentProfileId: string, tenantId: string, pagination: { limit: number; offset: number }): Promise<LearningSupportEvent[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_support_event
       WHERE student_profile_id = $1 AND tenant_id = $2
       ORDER BY occurred_at DESC
       LIMIT $3 OFFSET $4`,
      [studentProfileId, tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  async create(input: {
    tenantId: string;
    learningAttemptId: string;
    studentProfileId: string;
    actorStaffAccountId: string;
    actorRole: SupportActorRole;
    supportType: SupportType;
    intensity: SupportIntensity;
    occurredAt?: Date;
    durationSeconds?: number | null;
    noteStructuredRef?: string | null;
  }): Promise<LearningSupportEvent> {
    const publicId = `lse_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO learning_support_event
         (public_id, tenant_id, learning_attempt_id, student_profile_id, actor_staff_account_id, actor_role,
          support_type, intensity, occurred_at, duration_seconds, note_structured_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10, $11)
       RETURNING ${SELECT_COLUMNS}`,
      [
        publicId,
        input.tenantId,
        input.learningAttemptId,
        input.studentProfileId,
        input.actorStaffAccountId,
        input.actorRole,
        input.supportType,
        input.intensity,
        input.occurredAt ?? null,
        input.durationSeconds ?? null,
        input.noteStructuredRef ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
