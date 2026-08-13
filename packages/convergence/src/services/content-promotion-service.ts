import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { ConvergenceRequestRepository } from "../repository/convergence-request-repository";
import { MigrationPlanRepository } from "../repository/migration-plan-repository";

const OWNERSHIP_TRANSFER_PROMOTE_SCOPE = "ownership_transfer_promote";

/**
 * Ownership transfer (02_38 v1.4 §14, 02_26 v1.14 §36.11) --
 * capability-gated and plan-approval-gated end to end, but this Tranche
 * has no TEACHER_CONTENT-owning table in the Web schema yet (02_37
 * Teacher/School No-Code Authoring is out of scope of this tranche and
 * not implemented) -- so every real `contentId` resolves to
 * CONTENT_NOT_FOUND after passing the capability/approval checks. This
 * is a disclosed, honest gap (see the Tranche D Web final report), not a
 * silent stub: the endpoint enforces the full contract (capability,
 * convergence request state, plan decision) up to the point where an
 * actual owned-content row would be required.
 */
export class ContentPromotionService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly plans: MigrationPlanRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRecordRepository;

  constructor(private readonly pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.plans = new MigrationPlanRepository(pool);
    this.audit = new AuditRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
  }

  async promote(identity: StaffInternalIdentity, contentId: string, convergenceRequestId: string, idempotencyKey: string): Promise<never> {
    assertStaffCapability(identity, "ownership.transfer.approve");

    const request = await this.requests.findById(convergenceRequestId);
    if (!request || request.targetTenantId !== identity.tenantId) throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
    if (!["APPROVED", "READY_TO_EXECUTE", "EXECUTING"].includes(request.status)) {
      throw new StaffIdentityError("CONVERGENCE_REQUEST_INVALID_TRANSITION");
    }
    if (!request.currentMigrationPlanId) throw new StaffIdentityError("OWNERSHIP_PROMOTION_NOT_APPROVED");
    const plan = await this.plans.findById(request.currentMigrationPlanId);
    const approved = plan?.ownershipDecisions.some((d) => d.resourceId === contentId && d.decision === "PROMOTE");
    if (!approved) throw new StaffIdentityError("OWNERSHIP_PROMOTION_NOT_APPROVED");

    const scopeKey = `${contentId}:${convergenceRequestId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({ tenantId: identity.tenantId, scope: OWNERSHIP_TRANSFER_PROMOTE_SCOPE, scopeKey, requestHash: contentId });
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") throw new StaffIdentityError("IDEMPOTENCY_CONFLICT");
    if (begin.outcome === "RETRY_TOO_SOON") throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", undefined, { retryAfterSeconds: 5 });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD" || begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("CONTENT_NOT_FOUND", "No owned-content table exists yet (02_37 Authoring not implemented).");
    }

    await this.audit.record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: "ownership.promoted",
      targetType: "content",
      targetId: contentId,
      result: "FAILURE",
      metadataRedacted: { reason: "CONTENT_NOT_FOUND", convergenceRequestId },
    });
    await this.idempotency.fail({
      tenantId: identity.tenantId,
      scope: OWNERSHIP_TRANSFER_PROMOTE_SCOPE,
      scopeKey,
      expectedGeneration: begin.generation,
      retryable: false,
      response: { error: "CONTENT_NOT_FOUND" },
    });
    throw new StaffIdentityError("CONTENT_NOT_FOUND", "No owned-content table exists yet (02_37 Authoring not implemented).");
  }
}
