import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";
import type {
  LearningPathReasonCategory,
  LearningPathResourceType,
  LearningPathScope,
  LearningPathState,
} from "../resolver/resolve-effective-availability";

export interface LearningPathPolicy {
  id: string;
  publicId: string;
  tenantId: string;
  scope: LearningPathScope;
  scopeClassId: string | null;
  scopeStudentProfileId: string | null;
  resourceType: LearningPathResourceType;
  resourceRef: string;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  reasonNotes: string | null;
  alternativeContentRef: string | null;
  deploymentYear: string | null;
  createdByStaffAccountId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  scope: LearningPathScope;
  scope_class_id: string | null;
  scope_student_profile_id: string | null;
  resource_type: LearningPathResourceType;
  resource_ref: string;
  state: LearningPathState;
  reason_category: LearningPathReasonCategory;
  reason_notes: string | null;
  alternative_content_ref: string | null;
  deployment_year: string | null;
  created_by_staff_account_id: string;
  created_at: Date;
  updated_at: Date;
  version: number;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, scope, scope_class_id, scope_student_profile_id, resource_type, resource_ref,
  state, reason_category, reason_notes, alternative_content_ref, deployment_year, created_by_staff_account_id, created_at, updated_at, version`;

function mapRow(row: Row): LearningPathPolicy {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    scope: row.scope,
    scopeClassId: row.scope_class_id,
    scopeStudentProfileId: row.scope_student_profile_id,
    resourceType: row.resource_type,
    resourceRef: row.resource_ref,
    state: row.state,
    reasonCategory: row.reason_category,
    reasonNotes: row.reason_notes,
    alternativeContentRef: row.alternative_content_ref,
    deploymentYear: row.deployment_year,
    createdByStaffAccountId: row.created_by_staff_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export interface UpsertLearningPathPolicyInput {
  tenantId: string;
  scope: LearningPathScope;
  scopeClassId?: string | null;
  scopeStudentProfileId?: string | null;
  resourceType: LearningPathResourceType;
  resourceRef: string;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  reasonNotes?: string | null;
  alternativeContentRef?: string | null;
  deploymentYear?: string | null;
  createdByStaffAccountId: string;
}

/**
 * `learning_path_policy` (02_41 v1.1 §42, migration 0013) -- the single
 * unified scoped-policy model, never a table-per-scope. Upsert semantics on
 * `create()` -- a second write for the same (tenant, scope, scope-ref,
 * resource) updates the existing row rather than duplicating, matching the
 * DB's own `learning_path_policy_scope_resource_uq` unique index and
 * OpenAPI v1.15.0's `createOrUpdateLearningPathPolicy` operation.
 */
export class LearningPathPolicyRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<LearningPathPolicy | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_path_policy WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByPublicId(publicId: string, tenantId: string): Promise<LearningPathPolicy | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_path_policy WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * All explicit policies for one resource across every scope relevant to
   * the given class/student -- exactly what the resolver needs
   * (`policiesByScope`). PLATFORM and SCHOOL never carry a scope-ref;
   * CLASS/STUDENT are matched only when the caller supplies the
   * corresponding id, so a school-level lookup (no classId/studentProfileId)
   * naturally returns only PLATFORM/SCHOOL rows.
   */
  async findForResource(
    tenantId: string,
    resourceType: LearningPathResourceType,
    resourceRef: string,
    scopeRefs: { classId?: string | null | undefined; studentProfileId?: string | null | undefined },
  ): Promise<LearningPathPolicy[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_path_policy
       WHERE tenant_id = $1 AND resource_type = $2 AND resource_ref = $3
         AND (
           scope IN ('PLATFORM', 'SCHOOL')
           OR (scope = 'CLASS' AND scope_class_id = $4)
           OR (scope = 'STUDENT' AND scope_student_profile_id = $5)
         )`,
      [tenantId, resourceType, resourceRef, scopeRefs.classId ?? null, scopeRefs.studentProfileId ?? null],
    );
    return result.rows.map(mapRow);
  }

  /**
   * Every explicit policy touching a class (its own CLASS-scope rows,
   * plus every STUDENT-scope row for its roster) -- used to build a Class
   * or Student preview without one query per unit element. `classId` may
   * be `null` (student with no current enrollment, e.g. a
   * SUPPORT_TEACHER/ASACOM cross-class support assignment) -- PLATFORM/
   * SCHOOL rows are still returned; the CLASS clause simply never matches
   * (SQL `scope_class_id = NULL` is never true).
   */
  async findForClassAndStudents(tenantId: string, classId: string | null, studentProfileIds: string[]): Promise<LearningPathPolicy[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_path_policy
       WHERE tenant_id = $1
         AND (scope IN ('PLATFORM', 'SCHOOL')
              OR (scope = 'CLASS' AND scope_class_id = $2)
              OR (scope = 'STUDENT' AND scope_student_profile_id = ANY($3::uuid[])))`,
      [tenantId, classId, studentProfileIds],
    );
    return result.rows.map(mapRow);
  }

  async listByScope(
    tenantId: string,
    filter: {
      scope?: LearningPathScope | undefined;
      scopeRef?: string | undefined;
      resourceType?: LearningPathResourceType | undefined;
      resourceRef?: string | undefined;
    },
    pagination: { limit: number; offset: number },
  ): Promise<LearningPathPolicy[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.scope) {
      params.push(filter.scope);
      conditions.push(`scope = $${params.length}`);
    }
    if (filter.scopeRef) {
      params.push(filter.scopeRef);
      conditions.push(`(scope_class_id = $${params.length} OR scope_student_profile_id = $${params.length})`);
    }
    if (filter.resourceType) {
      params.push(filter.resourceType);
      conditions.push(`resource_type = $${params.length}`);
    }
    if (filter.resourceRef) {
      params.push(filter.resourceRef);
      conditions.push(`resource_ref = $${params.length}`);
    }
    params.push(pagination.limit, pagination.offset);
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_path_policy WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(mapRow);
  }

  /** Upsert on the unique (tenant, scope, scope-ref, resource) key -- `ON CONFLICT ... DO UPDATE`, never a separate read-then-write race. */
  async upsert(input: UpsertLearningPathPolicyInput): Promise<LearningPathPolicy> {
    const publicId = `lpp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO learning_path_policy
         (public_id, tenant_id, scope, scope_class_id, scope_student_profile_id, resource_type, resource_ref,
          state, reason_category, reason_notes, alternative_content_ref, deployment_year, created_by_staff_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (tenant_id, scope,
         COALESCE(scope_class_id, '00000000-0000-0000-0000-000000000000'::uuid),
         COALESCE(scope_student_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
         resource_type, resource_ref)
       DO UPDATE SET state = EXCLUDED.state, reason_category = EXCLUDED.reason_category, reason_notes = EXCLUDED.reason_notes,
         alternative_content_ref = EXCLUDED.alternative_content_ref, deployment_year = EXCLUDED.deployment_year,
         updated_at = now(), version = learning_path_policy.version + 1
       RETURNING ${SELECT_COLUMNS}`,
      [
        publicId,
        input.tenantId,
        input.scope,
        input.scopeClassId ?? null,
        input.scopeStudentProfileId ?? null,
        input.resourceType,
        input.resourceRef,
        input.state,
        input.reasonCategory,
        input.reasonNotes ?? null,
        input.alternativeContentRef ?? null,
        input.deploymentYear ?? null,
        input.createdByStaffAccountId,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... ON CONFLICT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Revert to INHERIT (02_41 §9): deletes the explicit policy row. Never a soft-delete -- INHERIT is the absence of a row, not a state value (migration 0013 header). */
  async delete(publicId: string, tenantId: string): Promise<boolean> {
    const result = await this.db.query(`DELETE FROM learning_path_policy WHERE public_id = $1 AND tenant_id = $2`, [publicId, tenantId]);
    return (result.rowCount ?? 0) > 0;
  }
}
