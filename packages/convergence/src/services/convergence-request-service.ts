import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, TenantRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError, StaffTenantMembershipRepository, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { PlatformAdminError, assertCapability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import { ConvergenceRequestRepository, type ConvergenceRequest } from "../repository/convergence-request-repository";
import { MigrationPlanRepository, type MigrationPlan } from "../repository/migration-plan-repository";

const CONVERGENCE_REQUEST_CREATE_SCOPE = "convergence_request_create";

function requestHash(input: { sourceTenantId: string; targetTenantId: string; educatorStaffAccountId: string }): string {
  return `${input.sourceTenantId}:${input.targetTenantId}:${input.educatorStaffAccountId}`;
}

/** Create/list/read (02_26 v1.14 §36.2-36.3) -- staff-session-authed, party-scoped. */
export class ConvergenceRequestService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly migrationPlans: MigrationPlanRepository;

  constructor(private readonly pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.migrationPlans = new MigrationPlanRepository(pool);
  }

  /**
   * The caller must be a party to the requested convergence: an
   * INDEPENDENT_EDUCATOR acting on their own source tenant, or a
   * SCHOOL_ADMIN acting on their own target tenant (02_38 v1.4 §10.3,
   * 02_35 v1.5 §11quater.3). Never a cross-coupling of the caller's
   * tenant with someone else's.
   */
  async create(
    identity: StaffInternalIdentity,
    input: { sourceTenantId: string; targetTenantId: string; educatorStaffAccountId?: string; idempotencyKey: string },
  ): Promise<ConvergenceRequest> {
    assertStaffCapability(identity, "convergence.request");

    let sourceTenantId: string;
    let targetTenantId: string;
    let educatorStaffAccountId: string;
    if (identity.role === "INDEPENDENT_EDUCATOR") {
      if (identity.tenantId !== input.sourceTenantId) {
        throw new StaffIdentityError("STAFF_FORBIDDEN", "Only the source tenant's own Independent Educator may request this convergence.");
      }
      sourceTenantId = input.sourceTenantId;
      targetTenantId = input.targetTenantId;
      educatorStaffAccountId = identity.staffAccountId;
    } else if (identity.role === "SCHOOL_ADMIN") {
      if (identity.tenantId !== input.targetTenantId) {
        throw new StaffIdentityError("STAFF_FORBIDDEN", "Only the target tenant's own School Admin may request this convergence.");
      }
      if (!input.educatorStaffAccountId) {
        throw new StaffIdentityError("VALIDATION_ERROR", "educatorStaffAccountId is required when a School Admin initiates.");
      }
      sourceTenantId = input.sourceTenantId;
      targetTenantId = input.targetTenantId;
      educatorStaffAccountId = input.educatorStaffAccountId;
    } else {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "TEACHER is never a party to Account/Tenant Convergence.");
    }

    const sourceTenant = await this.tenants.findById(sourceTenantId);
    const targetTenant = await this.tenants.findById(targetTenantId);
    if (!sourceTenant || sourceTenant.type !== "INDEPENDENT_EDUCATOR" || !targetTenant || targetTenant.type !== "SCHOOL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "sourceTenantId must be an INDEPENDENT_EDUCATOR tenant and targetTenantId a SCHOOL tenant.");
    }
    if (sourceTenant.status !== "ACTIVE" || targetTenant.status !== "ACTIVE") {
      throw new StaffIdentityError("TENANT_SUSPENDED_FOR_CONVERGENCE", "Neither tenant may be SUSPENDED.");
    }

    const existing = await this.requests.findActiveByTriple(sourceTenantId, targetTenantId, educatorStaffAccountId);
    if (existing) {
      return existing;
    }

    const targetMembership = await this.memberships.findByStaffAccountAndTenant(educatorStaffAccountId, targetTenantId);
    if (targetMembership && targetMembership.status === "ACTIVE") {
      await this.audit.record({
        tenantId: targetTenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "convergence.requested",
        targetType: "staff_account",
        targetId: educatorStaffAccountId,
        result: "FAILURE",
        metadataRedacted: { reason: "CONVERGENCE_ALREADY_MEMBER" },
      });
      throw new StaffIdentityError("CONVERGENCE_ALREADY_MEMBER", "This identity already holds an ACTIVE membership on the target tenant.");
    }

    const scopeKey = `${identity.staffAccountId}:${input.idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: null,
      scope: CONVERGENCE_REQUEST_CREATE_SCOPE,
      scopeKey,
      requestHash: requestHash({ sourceTenantId, targetTenantId, educatorStaffAccountId }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as ConvergenceRequest;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT");
    }
    if (begin.outcome === "RETRY_TOO_SOON" || begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", undefined, { retryAfterSeconds: 5 });
    }

    try {
      const created = await this.requests.create({
        publicId: `cvg_${randomUUID()}`,
        sourceTenantId,
        targetTenantId,
        educatorStaffAccountId,
        requestedByStaffAccountId: identity.staffAccountId,
      });

      await this.idempotency.complete({
        tenantId: null,
        scope: CONVERGENCE_REQUEST_CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });

      await this.audit.record({
        tenantId: targetTenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "convergence.requested",
        targetType: "convergence_request",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { sourceTenantId, targetTenantId },
      });

      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: null,
        scope: CONVERGENCE_REQUEST_CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      // A race on the DB-level partial unique index (two concurrent
      // creates for the same triple) surfaces here as a unique_violation;
      // resolve it the same way as the pre-check above -- return the row
      // that won the race, never a 500.
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505") {
        const winner = await this.requests.findActiveByTriple(sourceTenantId, targetTenantId, educatorStaffAccountId);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private assertStaffIsParty(identity: StaffInternalIdentity, request: ConvergenceRequest): void {
    if (identity.tenantId !== request.sourceTenantId && identity.tenantId !== request.targetTenantId) {
      throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
    }
  }

  async getByIdForStaff(identity: StaffInternalIdentity, id: string): Promise<ConvergenceRequest> {
    assertStaffCapability(identity, "convergence.read");
    const request = await this.requests.findById(id);
    if (!request) throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
    this.assertStaffIsParty(identity, request);
    return request;
  }

  /**
   * Same party-scoped read as `getByIdForStaff`, additionally resolving the
   * request's current migration plan (already generated by PLATFORM_ADMIN's
   * preview step and persisted on `migration_plan` -- no new endpoint, no
   * new capability, just surfacing an already-authorized read to the
   * teacher/school party who must act on it in `POST .../approve`).
   */
  async getByIdForStaffWithPlan(
    identity: StaffInternalIdentity,
    id: string,
  ): Promise<{ request: ConvergenceRequest; migrationPlan: MigrationPlan | null }> {
    const request = await this.getByIdForStaff(identity, id);
    const migrationPlan = request.currentMigrationPlanId ? await this.migrationPlans.findById(request.currentMigrationPlanId) : null;
    return { request, migrationPlan };
  }

  async listForStaff(identity: StaffInternalIdentity, pagination: { limit: number; offset: number }): Promise<ConvergenceRequest[]> {
    assertStaffCapability(identity, "convergence.read");
    if (identity.role === "INDEPENDENT_EDUCATOR") {
      return this.requests.findBySourceTenant(identity.tenantId, pagination);
    }
    return this.requests.findByTargetTenant(identity.tenantId, pagination);
  }

  /** PLATFORM_ADMIN cross-tenant visibility, unscoped (02_38 v1.4 §4.1, always explicit and audited). */
  async listForPlatformAdmin(identity: PlatformAdminIdentity, pagination: { limit: number; offset: number }): Promise<ConvergenceRequest[]> {
    assertCapability(identity, "convergence.read");
    return this.requests.findAll(pagination);
  }

  async getByIdForPlatformAdmin(identity: PlatformAdminIdentity, id: string): Promise<ConvergenceRequest> {
    assertCapability(identity, "convergence.read");
    const request = await this.requests.findById(id);
    if (!request) throw new PlatformAdminError("CONVERGENCE_REQUEST_NOT_FOUND");
    return request;
  }
}
