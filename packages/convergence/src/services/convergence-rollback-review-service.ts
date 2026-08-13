import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { PlatformAdminError, assertCapability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import { ConvergenceRequestRepository, type ConvergenceRequest } from "../repository/convergence-request-repository";
import { MigrationExecutionRepository } from "../repository/migration-execution-repository";

/**
 * Rollback review (02_38 v1.4 §10.5, 02_26 v1.14 §36.8) -- PLATFORM_ADMIN-only.
 * Never a total automatic rollback: ACCEPT_PARTIAL closes the request with
 * the partial state as final; RETRY_REMAINING reopens execution so a
 * fresh `execute()` call resumes from `checkpoint_json`, never
 * re-processing an already MIGRATED/RETAINED unit.
 */
export class ConvergenceRollbackReviewService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly executions: MigrationExecutionRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.executions = new MigrationExecutionRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async resolve(
    identity: PlatformAdminIdentity,
    requestId: string,
    decision: "ACCEPT_PARTIAL" | "RETRY_REMAINING",
  ): Promise<ConvergenceRequest> {
    assertCapability(identity, "convergence.rollback.review");

    const request = await this.requests.findById(requestId);
    if (!request) throw new PlatformAdminError("CONVERGENCE_REQUEST_NOT_FOUND");
    if (request.status !== "ROLLBACK_REVIEW_REQUIRED") {
      throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", `Cannot resolve rollback review for a request in status ${request.status}.`);
    }
    if (!request.currentMigrationExecutionId) {
      throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", "No migration execution to review.");
    }

    const resolvedExecution = await this.executions.resolveRollbackReview(request.currentMigrationExecutionId, decision, identity.staffAccountId);
    if (!resolvedExecution) throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION");

    const nextStatus = decision === "ACCEPT_PARTIAL" ? "COMPLETED" : "READY_TO_EXECUTE";
    const updated = await this.requests.transition(requestId, "ROLLBACK_REVIEW_REQUIRED", nextStatus, {});
    if (!updated) throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION");

    await this.audit.record({
      tenantId: request.targetTenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "convergence.rollback_review_resolved",
      targetType: "migration_execution",
      targetId: request.currentMigrationExecutionId,
      result: "SUCCESS",
      metadataRedacted: { decision },
    });

    return updated;
  }
}
