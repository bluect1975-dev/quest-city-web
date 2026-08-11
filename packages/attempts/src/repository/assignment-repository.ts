import type { Queryable } from "./types";

export type AssignmentStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type CompletionPolicy = "FIRST_VALID_COMPLETION";
export type CreatedByActorType = "ADMIN_SEED_SCRIPT" | "SYSTEM" | "STAFF";
/**
 * WEB-M3B (02_35 §11.3, migration 0004): ADMIN_SEED is the pre-existing,
 * unchanged behaviour (class-wide, targetStudentProfileId null).
 * RECOVERY_FROM_REVIEW is the narrowly-scoped, single-student-targeted
 * creation path. STAFF_GENERAL (School Onboarding + Staff Membership,
 * 02_35 v1.2 §11bis.9, migration 0008) is the second, narrowly-scoped
 * exception to AGENTS.md rule 16 — class-wide like ADMIN_SEED
 * (targetStudentProfileId stays null), distinct from
 * RECOVERY_FROM_REVIEW. No fourth value without a dedicated ADR.
 */
export type AssignmentOriginType = "ADMIN_SEED" | "RECOVERY_FROM_REVIEW" | "STAFF_GENERAL";

export interface Assignment {
  id: string;
  tenantId: string;
  classId: string;
  publicId: string;
  title: string;
  status: AssignmentStatus;
  opensAt: Date | null;
  dueAt: Date | null;
  createdByActorType: CreatedByActorType;
  createdByActorId: string;
  completionPolicy: CompletionPolicy;
  contentBundleId: string;
  createdAt: Date;
  allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  originType: AssignmentOriginType;
  targetStudentProfileId: string | null;
}

interface AssignmentRow {
  id: string;
  tenant_id: string;
  class_id: string;
  public_id: string;
  title: string;
  status: AssignmentStatus;
  opens_at: Date | null;
  due_at: Date | null;
  created_by_actor_type: CreatedByActorType;
  created_by_actor_id: string;
  completion_policy: CompletionPolicy;
  content_bundle_id: string;
  created_at: Date;
  origin_type: AssignmentOriginType;
  target_student_profile_id: string | null;
}

const SELECT_COLUMNS = `id, tenant_id, class_id, public_id, title, status, opens_at, due_at,
       created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id, created_at,
       origin_type, target_student_profile_id`;

function mapRow(row: AssignmentRow, allowedRuntimeChannels: Array<"WEB" | "ROBLOX">): Assignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    publicId: row.public_id,
    title: row.title,
    status: row.status,
    opensAt: row.opens_at,
    dueAt: row.due_at,
    createdByActorType: row.created_by_actor_type,
    createdByActorId: row.created_by_actor_id,
    completionPolicy: row.completion_policy,
    contentBundleId: row.content_bundle_id,
    createdAt: row.created_at,
    allowedRuntimeChannels,
    originType: row.origin_type,
    targetStudentProfileId: row.target_student_profile_id,
  };
}

export class AssignmentRepository {
  constructor(private readonly db: Queryable) {}

  private async runtimeChannelsFor(assignmentId: string): Promise<Array<"WEB" | "ROBLOX">> {
    const result = await this.db.query<{ runtime_channel: "WEB" | "ROBLOX" }>(
      `SELECT runtime_channel FROM assignment_runtime_channel WHERE assignment_id = $1`,
      [assignmentId],
    );
    return result.rows.map((r) => r.runtime_channel);
  }

  async findByIdAndTenant(id: string, tenantId: string): Promise<Assignment | null> {
    const result = await this.db.query<AssignmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM assignment WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    if (!row) return null;
    return mapRow(row, await this.runtimeChannelsFor(row.id));
  }

  async findByPublicIdAndTenant(publicId: string, tenantId: string): Promise<Assignment | null> {
    const result = await this.db.query<AssignmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM assignment WHERE public_id = $1 AND tenant_id = $2`,
      [publicId, tenantId],
    );
    const [row] = result.rows;
    if (!row) return null;
    return mapRow(row, await this.runtimeChannelsFor(row.id));
  }

  /**
   * Administrative/seed provisioning only (AGENTS.md §4.21 rule 16) — no
   * public create/update endpoint exists. `createdByActorType` is
   * restricted to ADMIN_SEED_SCRIPT/SYSTEM; no staff identity exists yet.
   */
  async create(input: {
    tenantId: string;
    classId: string;
    publicId: string;
    title: string;
    status: AssignmentStatus;
    opensAt?: Date | null;
    dueAt?: Date | null;
    createdByActorType: CreatedByActorType;
    createdByActorId: string;
    completionPolicy: CompletionPolicy;
    contentBundleId: string;
    allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
    /** WEB-M3B (02_35 §11.3): defaults preserve the exact pre-existing ADMIN_SEED behaviour. */
    originType?: AssignmentOriginType;
    targetStudentProfileId?: string | null;
  }): Promise<Assignment> {
    const originType = input.originType ?? "ADMIN_SEED";
    const targetStudentProfileId = input.targetStudentProfileId ?? null;
    const result = await this.db.query<AssignmentRow>(
      `INSERT INTO assignment
         (tenant_id, class_id, public_id, title, status, opens_at, due_at,
          created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id,
          origin_type, target_student_profile_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.classId,
        input.publicId,
        input.title,
        input.status,
        input.opensAt ?? null,
        input.dueAt ?? null,
        input.createdByActorType,
        input.createdByActorId,
        input.completionPolicy,
        input.contentBundleId,
        originType,
        targetStudentProfileId,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    for (const channel of input.allowedRuntimeChannels) {
      await this.db.query(
        `INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, $3)`,
        [row.id, input.tenantId, channel],
      );
    }
    return mapRow(row, input.allowedRuntimeChannels);
  }
}
