import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { StaffTenantMembershipRepository } from "@quest-city-web/staff-identity";
import { PlatformAdminError, assertCapability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { ConvergenceRequestRepository } from "../repository/convergence-request-repository";
import { MigrationPlanRepository } from "../repository/migration-plan-repository";
import { MigrationExecutionRepository, type MigrationExecution, type UnitCheckpointEntry } from "../repository/migration-execution-repository";

const CONVERGENCE_EXECUTE_SCOPE = "convergence_execute";

/**
 * Per-unit transactional execution (02_38 v1.4 §10.4/§10.5, 02_26 v1.14
 * §36.7) -- PLATFORM_ADMIN-only. Never a single monolithic transaction
 * for the whole request: one transaction per unit (membership, then one
 * per class), so a partial failure leaves already-migrated units in
 * their new, consistent state and unprocessed units untouched.
 */
export class ConvergenceExecutionService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly plans: MigrationPlanRepository;
  private readonly executions: MigrationExecutionRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRecordRepository;

  constructor(private readonly pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.plans = new MigrationPlanRepository(pool);
    this.executions = new MigrationExecutionRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.audit = new AuditRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
  }

  async execute(identity: PlatformAdminIdentity, requestId: string, idempotencyKey: string): Promise<MigrationExecution> {
    assertCapability(identity, "convergence.execute");

    const request = await this.requests.findById(requestId);
    if (!request) throw new PlatformAdminError("CONVERGENCE_REQUEST_NOT_FOUND");
    if (request.status !== "APPROVED" && request.status !== "READY_TO_EXECUTE") {
      if (request.status === "EXECUTING") throw new PlatformAdminError("CONVERGENCE_EXECUTION_IN_PROGRESS", undefined, { retryAfterSeconds: 5 });
      throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", `Cannot execute a request in status ${request.status}.`);
    }
    if (!request.currentMigrationPlanId) throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", "No confirmed migration plan.");
    const plan = await this.plans.findById(request.currentMigrationPlanId);
    if (!plan || plan.status !== "CONFIRMED") throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", "Migration plan not confirmed.");

    // Active-attempt guard (02_38 v1.4 §12/§10.2bis): TRANSFER-decision
    // classes must have no CREATED/IN_PROGRESS attempt.
    const transferClassIds = plan.classDecisions.filter((d) => d.decision === "TRANSFER").map((d) => d.classId);
    const blockingAttempts = plan.activeAttemptsSnapshot.filter((a) => transferClassIds.includes(a.classId));
    if (blockingAttempts.length > 0) {
      throw new PlatformAdminError("CONVERGENCE_ACTIVE_ATTEMPTS_PENDING", `${blockingAttempts.length} active learning_attempt(s) block the transfer of one or more classes.`);
    }

    const lockedRequest = await this.requests.transition(requestId, request.status, "EXECUTING", {});
    if (!lockedRequest) throw new PlatformAdminError("CONVERGENCE_EXECUTION_IN_PROGRESS", undefined, { retryAfterSeconds: 5 });

    const scopeKey = `${requestId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: null,
      scope: CONVERGENCE_EXECUTE_SCOPE,
      scopeKey,
      requestHash: requestId,
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") return begin.response as MigrationExecution;
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") throw new PlatformAdminError("IDEMPOTENCY_CONFLICT");
    if (begin.outcome === "RETRY_TOO_SOON" || begin.outcome === "FAILED_TERMINAL") {
      throw new PlatformAdminError("IDEMPOTENCY_IN_PROGRESS", undefined, { retryAfterSeconds: 5 });
    }

    const convergenceRunId = `run_${randomUUID()}`;
    const unitsTotal = 1 + plan.classDecisions.length;
    const execution = await this.executions.create({
      migrationPlanId: plan.id,
      convergenceRequestId: requestId,
      convergenceRunId,
      unitsTotal,
    });
    await this.requests.transition(requestId, "EXECUTING", "EXECUTING", { currentMigrationExecutionId: execution.id });
    await this.audit.record({
      tenantId: request.targetTenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "convergence.execution_started",
      targetType: "migration_execution",
      targetId: execution.id,
      result: "SUCCESS",
      metadataRedacted: { unitsTotal },
    });

    const checkpoint: UnitCheckpointEntry[] = [];
    let unitsMigrated = 0;
    let unitsFailed = 0;

    // Unit 1: membership (must run before any TRANSFER class unit, since
    // staff_class_assignment must point to the new target membership).
    let targetMembershipId: string | null = null;
    try {
      const existingTarget = await this.memberships.findByStaffAccountAndTenant(request.educatorStaffAccountId, request.targetTenantId);
      if (existingTarget && existingTarget.status === "ACTIVE") {
        targetMembershipId = existingTarget.id;
        checkpoint.push({ unitType: "MEMBERSHIP", unitId: "membership", outcome: "RETAINED" });
      } else {
        const created = await this.memberships.create({
          staffAccountId: request.educatorStaffAccountId,
          tenantId: request.targetTenantId,
          role: "TEACHER",
          status: "ACTIVE",
        });
        targetMembershipId = created.id;
        checkpoint.push({ unitType: "MEMBERSHIP", unitId: "membership", outcome: "MIGRATED" });
        await this.audit.record({
          tenantId: request.targetTenantId,
          actorType: "PLATFORM_ADMIN",
          actorId: identity.staffAccountId,
          action: "convergence.unit_migrated",
          targetType: "staff_tenant_membership",
          targetId: created.id,
          result: "SUCCESS",
          metadataRedacted: { unitType: "MEMBERSHIP" },
        });
      }
      unitsMigrated += 1;
    } catch (error) {
      checkpoint.push({ unitType: "MEMBERSHIP", unitId: "membership", outcome: "FAILED", reason: error instanceof Error ? error.message : String(error) });
      unitsFailed += 1;
    }
    await this.executions.recordUnitOutcome(execution.id, checkpoint, unitsMigrated, unitsFailed);

    // Unit N: one per class.
    for (const decision of plan.classDecisions) {
      if (decision.decision === "RETAIN") {
        checkpoint.push({ unitType: "CLASS", unitId: decision.classId, outcome: "RETAINED" });
        unitsMigrated += 1;
        await this.executions.recordUnitOutcome(execution.id, checkpoint, unitsMigrated, unitsFailed);
        continue;
      }
      if (!targetMembershipId) {
        checkpoint.push({ unitType: "CLASS", unitId: decision.classId, outcome: "FAILED", reason: "Membership unit did not complete; class transfer skipped." });
        unitsFailed += 1;
        await this.executions.recordUnitOutcome(execution.id, checkpoint, unitsMigrated, unitsFailed);
        continue;
      }
      try {
        await this.transferClass(decision.classId, request.sourceTenantId, request.targetTenantId, targetMembershipId);
        checkpoint.push({ unitType: "CLASS", unitId: decision.classId, outcome: "MIGRATED" });
        unitsMigrated += 1;
        await this.audit.record({
          tenantId: request.targetTenantId,
          actorType: "PLATFORM_ADMIN",
          actorId: identity.staffAccountId,
          action: "convergence.unit_migrated",
          targetType: "school_class",
          targetId: decision.classId,
          result: "SUCCESS",
          metadataRedacted: { unitType: "CLASS" },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        checkpoint.push({ unitType: "CLASS", unitId: decision.classId, outcome: "FAILED", reason });
        unitsFailed += 1;
        await this.audit.record({
          tenantId: request.targetTenantId,
          actorType: "PLATFORM_ADMIN",
          actorId: identity.staffAccountId,
          action: "convergence.conflict_detected",
          targetType: "school_class",
          targetId: decision.classId,
          result: "FAILURE",
          metadataRedacted: { reason },
        });
      }
      await this.executions.recordUnitOutcome(execution.id, checkpoint, unitsMigrated, unitsFailed);
    }

    const allSucceeded = unitsFailed === 0;
    const finished = await this.executions.finish(
      execution.id,
      allSucceeded ? "COMPLETED" : "ROLLBACK_REVIEW_REQUIRED",
      { checkpoint, unitsTotal, unitsMigrated, unitsFailed },
      allSucceeded ? null : `${unitsFailed} unit(s) failed`,
    );
    if (!finished) throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", "migration_execution row disappeared mid-execution.");
    const finalRequestStatus = allSucceeded ? "COMPLETED" : "ROLLBACK_REVIEW_REQUIRED";
    await this.requests.transition(requestId, "EXECUTING", finalRequestStatus, {});

    await this.idempotency.complete({
      tenantId: null,
      scope: CONVERGENCE_EXECUTE_SCOPE,
      scopeKey,
      expectedGeneration: begin.generation,
      response: finished,
    });

    await this.audit.record({
      tenantId: request.targetTenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: allSucceeded ? "convergence.completed" : "convergence.failed",
      targetType: "convergence_request",
      targetId: requestId,
      result: allSucceeded ? "SUCCESS" : "FAILURE",
      metadataRedacted: { unitsMigrated, unitsFailed },
    });
    if (!allSucceeded) {
      await this.audit.record({
        tenantId: request.targetTenantId,
        actorType: "PLATFORM_ADMIN",
        actorId: identity.staffAccountId,
        action: "convergence.rollback_review_requested",
        targetType: "migration_execution",
        targetId: execution.id,
        result: "SUCCESS",
        metadataRedacted: {},
      });
    }

    return finished;
  }

  /**
   * Cross-tenant class transfer. Runs inside one transaction with
   * `SET CONSTRAINTS ALL DEFERRED` (migration 0011 marked the relevant
   * composite FK chain DEFERRABLE INITIALLY DEFERRED specifically for
   * this) -- every child row's `tenant_id` is repointed before the
   * parent `school_class` row itself, and the whole chain is checked
   * consistent only at COMMIT.
   */
  private async transferClass(classId: string, sourceTenantId: string, targetTenantId: string, targetMembershipId: string): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");

      // Reject if any enrolled student is also actively enrolled in a
      // DIFFERENT class of the source tenant (structural conflict --
      // this schema cannot represent one student split across two
      // tenants simultaneously). Detected here, not at preview time,
      // because it depends on the final approved decision set.
      const conflictCheck = await client.query<{ student_profile_id: string }>(
        `SELECT DISTINCT e1.student_profile_id
         FROM school_enrollment e1
         JOIN school_enrollment e2
           ON e2.student_profile_id = e1.student_profile_id
          AND e2.tenant_id = e1.tenant_id
          AND e2.class_id <> e1.class_id
          AND e2.status = 'ACTIVE'
         WHERE e1.class_id = $1 AND e1.tenant_id = $2 AND e1.status = 'ACTIVE'`,
        [classId, sourceTenantId],
      );
      if (conflictCheck.rows.length > 0) {
        throw new Error(`STUDENT_MULTI_TENANT_ENROLLMENT_CONFLICT: ${conflictCheck.rows.length} student(s) also enrolled in another class of the source tenant`);
      }

      const studentIds = await client.query<{ student_profile_id: string }>(
        `SELECT student_profile_id FROM school_enrollment WHERE class_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
        [classId, sourceTenantId],
      );
      const studentProfileIds = studentIds.rows.map((r) => r.student_profile_id);

      if (studentProfileIds.length > 0) {
        await client.query(`UPDATE student_profile SET tenant_id = $1 WHERE id = ANY($2::uuid[]) AND tenant_id = $3`, [targetTenantId, studentProfileIds, sourceTenantId]);
        await client.query(`UPDATE school_enrollment SET tenant_id = $1 WHERE class_id = $2 AND tenant_id = $3`, [targetTenantId, classId, sourceTenantId]);
        await client.query(
          `UPDATE learning_attempt SET tenant_id = $1
           WHERE tenant_id = $2 AND student_profile_id = ANY($3::uuid[])
             AND enrollment_id IN (SELECT id FROM school_enrollment WHERE class_id = $4 AND tenant_id = $1)`,
          [targetTenantId, sourceTenantId, studentProfileIds, classId],
        );
      }

      await client.query(`UPDATE class_access_code SET tenant_id = $1 WHERE class_id = $2 AND tenant_id = $3`, [targetTenantId, classId, sourceTenantId]);

      const assignmentIds = await client.query<{ id: string }>(`SELECT id FROM assignment WHERE class_id = $1 AND tenant_id = $2`, [classId, sourceTenantId]);
      const assignmentIdList = assignmentIds.rows.map((r) => r.id);
      if (assignmentIdList.length > 0) {
        await client.query(`UPDATE assignment_runtime_channel SET tenant_id = $1 WHERE assignment_id = ANY($2::uuid[]) AND tenant_id = $3`, [targetTenantId, assignmentIdList, sourceTenantId]);
        await client.query(
          `UPDATE learning_attempt SET tenant_id = $1 WHERE assignment_id = ANY($2::uuid[]) AND tenant_id = $3`,
          [targetTenantId, assignmentIdList, sourceTenantId],
        );
      }
      await client.query(`UPDATE assignment SET tenant_id = $1 WHERE class_id = $2 AND tenant_id = $3`, [targetTenantId, classId, sourceTenantId]);

      await client.query(
        `UPDATE staff_class_assignment SET staff_tenant_membership_id = $1, tenant_id = $2 WHERE class_id = $3 AND tenant_id = $4`,
        [targetMembershipId, targetTenantId, classId, sourceTenantId],
      );

      await client.query(`UPDATE school_class SET tenant_id = $1 WHERE id = $2 AND tenant_id = $3`, [targetTenantId, classId, sourceTenantId]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
