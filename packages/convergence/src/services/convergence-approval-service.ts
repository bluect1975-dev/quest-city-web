import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { ConvergenceRequestRepository, type ConvergenceRequest } from "../repository/convergence-request-repository";
import { MigrationPlanRepository, type ClassDecisionEntry, type OwnershipDecisionEntry } from "../repository/migration-plan-repository";

/** Unified approve/reject (02_38 v1.4 §10.3, 02_26 v1.14 §36.5-36.6) -- staff-session-authed, party-scoped. */
export class ConvergenceApprovalService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly plans: MigrationPlanRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.plans = new MigrationPlanRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  private resolveSide(identity: StaffInternalIdentity, request: ConvergenceRequest): "teacher" | "school" {
    if (identity.tenantId === request.sourceTenantId) return "teacher";
    if (identity.tenantId === request.targetTenantId) return "school";
    throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
  }

  async approve(
    identity: StaffInternalIdentity,
    requestId: string,
    input: { migrationPlanFingerprint: string; classDecisions?: ClassDecisionEntry[]; ownershipDecisions?: OwnershipDecisionEntry[] },
  ): Promise<ConvergenceRequest> {
    const request = await this.requests.findById(requestId);
    if (!request) throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
    const side = this.resolveSide(identity, request);
    assertStaffCapability(identity, side === "teacher" ? "convergence.approve.teacher" : "convergence.approve.school");

    if (request.status !== "PREVIEW_READY" && request.status !== "AWAITING_APPROVALS") {
      throw new StaffIdentityError("CONVERGENCE_REQUEST_INVALID_TRANSITION", `Cannot approve a request in status ${request.status}.`);
    }
    if (!request.currentMigrationPlanId) {
      throw new StaffIdentityError("CONVERGENCE_PREVIEW_STALE", "No preview has been generated yet.");
    }
    const plan = await this.plans.findById(request.currentMigrationPlanId);
    if (!plan || plan.fingerprint !== input.migrationPlanFingerprint || plan.status === "STALE") {
      throw new StaffIdentityError("CONVERGENCE_PREVIEW_STALE");
    }

    const classDecisions = input.classDecisions && input.classDecisions.length > 0 ? input.classDecisions : plan.classDecisions;
    const ownershipDecisions = input.ownershipDecisions && input.ownershipDecisions.length > 0 ? input.ownershipDecisions : plan.ownershipDecisions;

    const validClassIds = new Set(plan.classesConsidered.map((c) => c.classId));
    for (const decision of classDecisions) {
      if (!validClassIds.has(decision.classId)) {
        throw new StaffIdentityError("VALIDATION_ERROR", `classId ${decision.classId} is not part of this migration plan.`);
      }
    }

    await this.plans.recordDecisions(
      plan.id,
      classDecisions.map((d) => ({ ...d, decidedByStaffAccountId: identity.staffAccountId, decidedAt: new Date().toISOString() })),
      ownershipDecisions.map((d) => ({ ...d, decidedByStaffAccountId: identity.staffAccountId, decidedAt: new Date().toISOString() })),
    );

    const now = new Date();
    const teacherConfirmedAt = side === "teacher" ? now : request.teacherConfirmedAt ?? undefined;
    const schoolApprovedAt = side === "school" ? now : request.schoolApprovedAt ?? undefined;
    const bothApproved = Boolean(teacherConfirmedAt) && Boolean(schoolApprovedAt);
    const nextStatus = bothApproved ? "APPROVED" : "AWAITING_APPROVALS";

    const updated = await this.requests.transition(requestId, request.status, nextStatus, {
      ...(side === "teacher" ? { teacherConfirmedAt: now } : {}),
      ...(side === "school" ? { schoolApprovedAt: now, schoolApprovedByStaffAccountId: identity.staffAccountId } : {}),
    });
    if (!updated) throw new StaffIdentityError("CONVERGENCE_REQUEST_INVALID_TRANSITION");

    await this.audit.record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: side === "teacher" ? "convergence.approved.teacher" : "convergence.approved.school",
      targetType: "convergence_request",
      targetId: requestId,
      result: "SUCCESS",
      metadataRedacted: { newStatus: nextStatus },
    });

    return updated;
  }

  async reject(identity: StaffInternalIdentity, requestId: string, reason: string | null): Promise<ConvergenceRequest> {
    const request = await this.requests.findById(requestId);
    if (!request) throw new StaffIdentityError("CONVERGENCE_REQUEST_NOT_FOUND");
    const side = this.resolveSide(identity, request);
    assertStaffCapability(identity, side === "teacher" ? "convergence.approve.teacher" : "convergence.approve.school");

    if (request.status !== "PREVIEW_READY" && request.status !== "AWAITING_APPROVALS") {
      throw new StaffIdentityError("CONVERGENCE_REQUEST_INVALID_TRANSITION", `Cannot reject a request in status ${request.status}.`);
    }

    const updated = await this.requests.transition(requestId, request.status, "REJECTED", {
      rejectedAt: new Date(),
      rejectedByStaffAccountId: identity.staffAccountId,
      ...(reason ? { rejectionReason: reason } : {}),
    });
    if (!updated) throw new StaffIdentityError("CONVERGENCE_REQUEST_INVALID_TRANSITION");

    await this.audit.record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: "convergence.rejected",
      targetType: "convergence_request",
      targetId: requestId,
      result: "SUCCESS",
      metadataRedacted: { side },
    });

    return updated;
  }
}
