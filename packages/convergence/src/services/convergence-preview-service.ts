import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, SchoolClassRepository, SchoolEnrollmentRepository, TenantRepository } from "@quest-city-web/identity";
import { StaffTenantMembershipRepository } from "@quest-city-web/staff-identity";
import { PlatformAdminError, assertCapability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import { ConvergenceRequestRepository } from "../repository/convergence-request-repository";
import { MigrationPlanRepository, type ActiveAttemptSnapshotEntry, type ClassConsidered, type MigrationPlan, type PlanConflict, type StudentAffected } from "../repository/migration-plan-repository";

function computeFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Preview + integrated identity verification (02_38 v1.4 §9/§10.2bis, 02_26 v1.14 §36.4) -- PLATFORM_ADMIN-only. */
export class ConvergencePreviewService {
  private readonly requests: ConvergenceRequestRepository;
  private readonly plans: MigrationPlanRepository;
  private readonly tenants: TenantRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly classes: SchoolClassRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.requests = new ConvergenceRequestRepository(pool);
    this.plans = new MigrationPlanRepository(pool);
    this.tenants = new TenantRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.classes = new SchoolClassRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async preview(identity: PlatformAdminIdentity, requestId: string): Promise<MigrationPlan> {
    assertCapability(identity, "convergence.preview");

    const request = await this.requests.findById(requestId);
    if (!request) throw new PlatformAdminError("CONVERGENCE_REQUEST_NOT_FOUND");
    if (request.status !== "REQUESTED" && request.status !== "PREVIEW_READY") {
      throw new PlatformAdminError("CONVERGENCE_REQUEST_INVALID_TRANSITION", `Cannot preview a request in status ${request.status}.`);
    }

    const sourceTenant = await this.tenants.findById(request.sourceTenantId);
    const targetTenant = await this.tenants.findById(request.targetTenantId);
    if (!sourceTenant || !targetTenant || sourceTenant.status !== "ACTIVE" || targetTenant.status !== "ACTIVE") {
      await this.requests.transition(requestId, request.status, "BLOCKED", { failureCode: "TENANT_SUSPENDED_FOR_CONVERGENCE" });
      throw new PlatformAdminError("TENANT_SUSPENDED_FOR_CONVERGENCE");
    }

    // Identity verification (02_38 v1.4 §9): the educator must actually
    // hold an ACTIVE INDEPENDENT_EDUCATOR membership on the source
    // tenant -- never a name/email heuristic.
    const educatorMembership = await this.memberships.findByStaffAccountAndTenant(request.educatorStaffAccountId, request.sourceTenantId);
    if (!educatorMembership || educatorMembership.status !== "ACTIVE" || educatorMembership.role !== "INDEPENDENT_EDUCATOR") {
      await this.requests.transition(requestId, request.status, "BLOCKED", { failureCode: "CONVERGENCE_IDENTITY_MISMATCH" });
      await this.audit.record({
        tenantId: request.sourceTenantId,
        actorType: "PLATFORM_ADMIN",
        actorId: identity.staffAccountId,
        action: "convergence.identity_verified",
        targetType: "convergence_request",
        targetId: requestId,
        result: "FAILURE",
        metadataRedacted: { reason: "CONVERGENCE_IDENTITY_MISMATCH" },
      });
      throw new PlatformAdminError("CONVERGENCE_IDENTITY_MISMATCH");
    }

    const sourceClasses = await this.classes.findByTenant(request.sourceTenantId);
    const activeClasses = sourceClasses.filter((c) => c.status === "ACTIVE");

    const classesConsidered: ClassConsidered[] = [];
    const studentsAffectedMap = new Map<string, StudentAffected>();
    const activeAttemptsSnapshot: ActiveAttemptSnapshotEntry[] = [];
    const warnings: string[] = [];
    const conflicts: PlanConflict[] = [];

    // Multi-class-in-source membership index, used to flag
    // hasNonSchoolStudents (02_25's schema has no cross-tenant identity
    // key to detect "already a student at the target school" -- that
    // conflict class is structurally undetectable here and is not
    // claimed; see the Tranche D Web final report).
    const enrollmentsByStudent = new Map<string, Set<string>>();
    for (const cls of activeClasses) {
      const enrollments = await this.enrollments.findByClass(cls.id, request.sourceTenantId);
      for (const enrollment of enrollments) {
        if (enrollment.status !== "ACTIVE") continue;
        const set = enrollmentsByStudent.get(enrollment.studentProfileId) ?? new Set<string>();
        set.add(cls.id);
        enrollmentsByStudent.set(enrollment.studentProfileId, set);
      }
    }

    for (const cls of activeClasses) {
      const enrollments = (await this.enrollments.findByClass(cls.id, request.sourceTenantId)).filter((e) => e.status === "ACTIVE");
      let hasMultiClassStudent = false;
      for (const enrollment of enrollments) {
        const classesForStudent = enrollmentsByStudent.get(enrollment.studentProfileId);
        if (classesForStudent && classesForStudent.size > 1) hasMultiClassStudent = true;
        if (!studentsAffectedMap.has(enrollment.studentProfileId)) {
          studentsAffectedMap.set(enrollment.studentProfileId, { studentPublicId: enrollment.studentProfileId, conflict: null });
        }
      }

      const attemptsResult = await this.pool.query<{ id: string; attempt_state: string }>(
        `SELECT la.id, la.attempt_state FROM learning_attempt la
         JOIN assignment a ON a.id = la.assignment_id AND a.tenant_id = la.tenant_id
         WHERE a.class_id = $1 AND la.tenant_id = $2 AND la.attempt_state IN ('CREATED', 'IN_PROGRESS')`,
        [cls.id, request.sourceTenantId],
      );
      for (const row of attemptsResult.rows) {
        activeAttemptsSnapshot.push({ learningAttemptId: row.id, classId: cls.id, attemptState: row.attempt_state });
      }

      classesConsidered.push({
        classId: cls.id,
        suggestedDecision: "RETAIN",
        studentsInClass: enrollments.length,
        hasNonSchoolStudents: hasMultiClassStudent,
      });
      if (hasMultiClassStudent) {
        warnings.push(`Class ${cls.id} has one or more students also enrolled in another class of the same source tenant -- transferring only a subset requires explicit per-class review to avoid CONVERGENCE_ACTIVE_ATTEMPTS_PENDING/student split conflicts at approval time.`);
      }
    }

    const fingerprint = computeFingerprint({ requestId, classesConsidered, generatedAt: Date.now() });
    const plan = await this.plans.create({
      convergenceRequestId: requestId,
      fingerprint,
      classesConsidered,
      studentsAffected: [...studentsAffectedMap.values()],
      conflicts,
      assignmentsAffected: [],
      activeAttemptsSnapshot,
      warnings,
      blockers: [],
    });

    await this.requests.transition(requestId, request.status, "PREVIEW_READY", {
      platformIdentityVerifiedAt: new Date(),
      platformIdentityVerifiedBy: identity.staffAccountId,
      currentMigrationPlanId: plan.id,
    });

    await this.audit.record({
      tenantId: request.sourceTenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "convergence.identity_verified",
      targetType: "convergence_request",
      targetId: requestId,
      result: "SUCCESS",
      metadataRedacted: {},
    });
    await this.audit.record({
      tenantId: request.sourceTenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "convergence.preview_generated",
      targetType: "migration_plan",
      targetId: plan.id,
      result: "SUCCESS",
      metadataRedacted: { classesConsidered: classesConsidered.length },
    });

    return plan;
  }
}
