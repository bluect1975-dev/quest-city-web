import type { Queryable } from "./types";

/**
 * Eleven-value closed state machine (02_38 v1.4 §10.2bis, 02_25 v1.10
 * §6.15). COMPLETED/REJECTED/BLOCKED are terminal -- a new row is created
 * to retry, never a resurrection of a terminal row.
 */
export type ConvergenceRequestStatus =
  | "REQUESTED"
  | "PREVIEW_READY"
  | "AWAITING_APPROVALS"
  | "APPROVED"
  | "READY_TO_EXECUTE"
  | "EXECUTING"
  | "COMPLETED"
  | "REJECTED"
  | "BLOCKED"
  | "FAILED"
  | "ROLLBACK_REVIEW_REQUIRED";

export interface ConvergenceRequest {
  id: string;
  publicId: string;
  sourceTenantId: string;
  targetTenantId: string;
  educatorStaffAccountId: string;
  requestedByStaffAccountId: string;
  status: ConvergenceRequestStatus;
  teacherConfirmedAt: Date | null;
  schoolApprovedAt: Date | null;
  schoolApprovedByStaffAccountId: string | null;
  platformIdentityVerifiedAt: Date | null;
  platformIdentityVerifiedBy: string | null;
  currentMigrationPlanId: string | null;
  currentMigrationExecutionId: string | null;
  rejectedAt: Date | null;
  rejectedByStaffAccountId: string | null;
  rejectionReason: string | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ConvergenceRequestRow {
  id: string;
  public_id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  educator_staff_account_id: string;
  requested_by_staff_account_id: string;
  status: ConvergenceRequestStatus;
  teacher_confirmed_at: Date | null;
  school_approved_at: Date | null;
  school_approved_by_staff_account_id: string | null;
  platform_identity_verified_at: Date | null;
  platform_identity_verified_by: string | null;
  current_migration_plan_id: string | null;
  current_migration_execution_id: string | null;
  rejected_at: Date | null;
  rejected_by_staff_account_id: string | null;
  rejection_reason: string | null;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, public_id, source_tenant_id, target_tenant_id, educator_staff_account_id,
  requested_by_staff_account_id, status, teacher_confirmed_at, school_approved_at,
  school_approved_by_staff_account_id, platform_identity_verified_at, platform_identity_verified_by,
  current_migration_plan_id, current_migration_execution_id, rejected_at, rejected_by_staff_account_id,
  rejection_reason, failure_code, created_at, updated_at`;

function mapRow(row: ConvergenceRequestRow): ConvergenceRequest {
  return {
    id: row.id,
    publicId: row.public_id,
    sourceTenantId: row.source_tenant_id,
    targetTenantId: row.target_tenant_id,
    educatorStaffAccountId: row.educator_staff_account_id,
    requestedByStaffAccountId: row.requested_by_staff_account_id,
    status: row.status,
    teacherConfirmedAt: row.teacher_confirmed_at,
    schoolApprovedAt: row.school_approved_at,
    schoolApprovedByStaffAccountId: row.school_approved_by_staff_account_id,
    platformIdentityVerifiedAt: row.platform_identity_verified_at,
    platformIdentityVerifiedBy: row.platform_identity_verified_by,
    currentMigrationPlanId: row.current_migration_plan_id,
    currentMigrationExecutionId: row.current_migration_execution_id,
    rejectedAt: row.rejected_at,
    rejectedByStaffAccountId: row.rejected_by_staff_account_id,
    rejectionReason: row.rejection_reason,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deliberately no single tenant_id column and no tenant-scoped findById
 * (02_25 v1.10 §6.15.0) -- a convergence_request relates two tenants by
 * construction. Callers scope explicitly via findBySourceTenant/
 * findByTargetTenant, or (PLATFORM_ADMIN only) findAll -- never an
 * unscoped read outside this repository.
 */
export class ConvergenceRequestRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<ConvergenceRequest | null> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `SELECT ${SELECT_COLUMNS} FROM convergence_request WHERE id = $1`,
      [id],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Anti-duplication lookup (partial unique index convergence_request_active_uq, migration 0011). */
  async findActiveByTriple(
    sourceTenantId: string,
    targetTenantId: string,
    educatorStaffAccountId: string,
  ): Promise<ConvergenceRequest | null> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `SELECT ${SELECT_COLUMNS} FROM convergence_request
       WHERE source_tenant_id = $1 AND target_tenant_id = $2 AND educator_staff_account_id = $3
         AND status NOT IN ('REJECTED', 'BLOCKED', 'COMPLETED')`,
      [sourceTenantId, targetTenantId, educatorStaffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findBySourceTenant(tenantId: string, pagination: { limit: number; offset: number }): Promise<ConvergenceRequest[]> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `SELECT ${SELECT_COLUMNS} FROM convergence_request WHERE source_tenant_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  async findByTargetTenant(tenantId: string, pagination: { limit: number; offset: number }): Promise<ConvergenceRequest[]> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `SELECT ${SELECT_COLUMNS} FROM convergence_request WHERE target_tenant_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  /** PLATFORM_ADMIN cross-tenant visibility only (02_38 v1.4 §4.1) -- never exposed to a staff-session caller. */
  async findAll(pagination: { limit: number; offset: number }): Promise<ConvergenceRequest[]> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `SELECT ${SELECT_COLUMNS} FROM convergence_request ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  async create(input: {
    publicId: string;
    sourceTenantId: string;
    targetTenantId: string;
    educatorStaffAccountId: string;
    requestedByStaffAccountId: string;
  }): Promise<ConvergenceRequest> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `INSERT INTO convergence_request
         (public_id, source_tenant_id, target_tenant_id, educator_staff_account_id, requested_by_staff_account_id, status)
       VALUES ($1, $2, $3, $4, $5, 'REQUESTED')
       RETURNING ${SELECT_COLUMNS}`,
      [input.publicId, input.sourceTenantId, input.targetTenantId, input.educatorStaffAccountId, input.requestedByStaffAccountId],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /**
   * Generic transition writer -- every state transition of 02_38 v1.4
   * §10.2bis goes through this single method, guarded by an expected
   * current status (optimistic, mirrors the ETAG_MISMATCH discipline used
   * elsewhere in this codebase) so two concurrent transitions never race
   * silently.
   */
  async transition(
    id: string,
    expectedStatus: ConvergenceRequestStatus,
    newStatus: ConvergenceRequestStatus,
    fields: Partial<{
      teacherConfirmedAt: Date;
      schoolApprovedAt: Date;
      schoolApprovedByStaffAccountId: string;
      platformIdentityVerifiedAt: Date;
      platformIdentityVerifiedBy: string;
      currentMigrationPlanId: string;
      currentMigrationExecutionId: string;
      rejectedAt: Date;
      rejectedByStaffAccountId: string;
      rejectionReason: string;
      failureCode: string | null;
    }> = {},
  ): Promise<ConvergenceRequest | null> {
    const result = await this.db.query<ConvergenceRequestRow>(
      `UPDATE convergence_request SET
         status = $3,
         teacher_confirmed_at = COALESCE($4, teacher_confirmed_at),
         school_approved_at = COALESCE($5, school_approved_at),
         school_approved_by_staff_account_id = COALESCE($6, school_approved_by_staff_account_id),
         platform_identity_verified_at = COALESCE($7, platform_identity_verified_at),
         platform_identity_verified_by = COALESCE($8, platform_identity_verified_by),
         current_migration_plan_id = COALESCE($9, current_migration_plan_id),
         current_migration_execution_id = COALESCE($10, current_migration_execution_id),
         rejected_at = COALESCE($11, rejected_at),
         rejected_by_staff_account_id = COALESCE($12, rejected_by_staff_account_id),
         rejection_reason = COALESCE($13, rejection_reason),
         failure_code = CASE WHEN $14::boolean THEN $15 ELSE failure_code END,
         updated_at = now()
       WHERE id = $1 AND status = $2
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        expectedStatus,
        newStatus,
        fields.teacherConfirmedAt ?? null,
        fields.schoolApprovedAt ?? null,
        fields.schoolApprovedByStaffAccountId ?? null,
        fields.platformIdentityVerifiedAt ?? null,
        fields.platformIdentityVerifiedBy ?? null,
        fields.currentMigrationPlanId ?? null,
        fields.currentMigrationExecutionId ?? null,
        fields.rejectedAt ?? null,
        fields.rejectedByStaffAccountId ?? null,
        fields.rejectionReason ?? null,
        "failureCode" in fields,
        fields.failureCode ?? null,
      ],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
