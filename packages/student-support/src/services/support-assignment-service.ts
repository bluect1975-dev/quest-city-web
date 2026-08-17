import type { Pool } from "pg";
import { AuditRepository, StudentProfileRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import {
  StaffIdentityError,
  StaffTenantMembershipRepository,
  assertStaffCapability,
  type StaffInternalIdentity,
} from "@quest-city-web/staff-identity";
import {
  SupportStudentAssignmentRepository,
  type SupportStudentAssignment,
  type SupportStudentAssignmentStatus,
} from "../repository/support-student-assignment-repository";

const IDEMPOTENCY_SCOPE = "support_student_assignment_create";

function requestHashOf(payload: unknown): string {
  // Lightweight, matches the pattern already used by StaffInvitationService
  // (createHash("sha256")) but this module has no other crypto need --
  // reusing an inline JSON stringify keeps the dependency surface minimal.
  return JSON.stringify(payload ?? null);
}

/**
 * `POST`/`GET /platform/support-assignments`, `PATCH .../status` (02_26
 * v1.16 §37.2). SCHOOL_ADMIN-only (`student_support_assignment.manage`,
 * 02_39 §8) -- never TEACHER, never self-assignment by ASACOM/SUPPORT_TEACHER.
 */
export class SupportAssignmentService {
  private readonly assignments: SupportStudentAssignmentRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly students: StudentProfileRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.assignments = new SupportStudentAssignmentRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    staffTenantMembershipId: string;
    studentPublicId: string;
    classId?: string | null;
    idempotencyKey: string;
  }): Promise<SupportStudentAssignment> {
    const { identity } = input;
    assertStaffCapability(identity, "student_support_assignment.manage");

    const targetMembership = await this.memberships.findById(input.staffTenantMembershipId, identity.tenantId);
    if (!targetMembership || !["ASACOM", "SUPPORT_TEACHER"].includes(targetMembership.role)) {
      throw new StaffIdentityError("VALIDATION_ERROR", "staffTenantMembershipId must reference an ACTIVE ASACOM or SUPPORT_TEACHER membership.");
    }
    if (targetMembership.status !== "ACTIVE") {
      throw new StaffIdentityError("VALIDATION_ERROR", "Target membership is not ACTIVE.");
    }

    const student = await this.students.findByPublicId(input.studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      // Anti-enumeration: unknown student and cross-tenant student
      // converge on the same generic validation failure -- never a
      // distinguishing STUDENT_NOT_FOUND leaking cross-tenant existence.
      throw new StaffIdentityError("VALIDATION_ERROR", "studentPublicId not found in this tenant.");
    }

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: requestHashOf({ staffTenantMembershipId: input.staffTenantMembershipId, studentProfileId: student.id }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as SupportStudentAssignment;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const created = await this.assignments.create({
        tenantId: identity.tenantId,
        staffTenantMembershipId: input.staffTenantMembershipId,
        studentProfileId: student.id,
        classId: input.classId ?? null,
        assignedByStaffAccountId: identity.staffAccountId,
      });

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "student_support.assigned",
        targetType: "support_student_assignment",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { role: targetMembership.role },
      });
      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /**
   * `GET /me/asacom-assigned-students` (02_26 v1.16 §37.3, also reused by
   * SUPPORT_TEACHER's own "My assigned students" surface) -- self-read,
   * no capability gate beyond holding the ASACOM/SUPPORT_TEACHER role
   * itself: the query IS the scope (only the caller's own ACTIVE rows).
   */
  async listMine(identity: StaffInternalIdentity): Promise<SupportStudentAssignment[]> {
    if (identity.role !== "ASACOM" && identity.role !== "SUPPORT_TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "Only ASACOM/SUPPORT_TEACHER hold support_student_assignment rows.");
    }
    const assignments = await this.assignments.findActiveByMembership(identity.staffTenantMembershipId, identity.tenantId);
    return this.withPublicStudentIds(assignments, identity.tenantId);
  }

  /**
   * `studentProfileId` (contract shape, unchanged field name) must never
   * carry the raw internal UUID out to a client -- same public_id
   * discipline as every other id-shaped field in this package. Resolved
   * in one batched query per call rather than N+1.
   */
  private async withPublicStudentIds(assignments: SupportStudentAssignment[], tenantId: string): Promise<SupportStudentAssignment[]> {
    const uniqueIds = [...new Set(assignments.map((a) => a.studentProfileId))];
    const students = await this.students.findByIds(uniqueIds, tenantId);
    const publicIdByProfileId = new Map(students.map((s) => [s.id, s.studentPublicId]));
    return assignments.map((a) => ({ ...a, studentProfileId: publicIdByProfileId.get(a.studentProfileId) ?? a.studentProfileId }));
  }

  async list(
    identity: StaffInternalIdentity,
    filter: { staffAccountId?: string | undefined; studentPublicId?: string | undefined; status?: SupportStudentAssignmentStatus | undefined },
    pagination: { limit: number; offset: number },
  ): Promise<SupportStudentAssignment[]> {
    assertStaffCapability(identity, "student_support_assignment.manage");
    let studentProfileId: string | undefined;
    if (filter.studentPublicId) {
      const student = await this.students.findByPublicId(filter.studentPublicId);
      if (!student || student.tenantId !== identity.tenantId) {
        return [];
      }
      studentProfileId = student.id;
    }
    const assignments = await this.assignments.findByTenant(
      identity.tenantId,
      {
        ...(filter.staffAccountId !== undefined ? { staffAccountId: filter.staffAccountId } : {}),
        ...(studentProfileId !== undefined ? { studentProfileId } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
      },
      pagination,
    );
    return this.withPublicStudentIds(assignments, identity.tenantId);
  }

  /** `PATCH /platform/support-assignments/{id}/status` (02_26 v1.16 §37.2) -- transition ACTIVE -> ENDED (natural) or ACTIVE -> REVOKED (early). */
  async transitionStatus(input: {
    identity: StaffInternalIdentity;
    id: string;
    targetStatus: "ENDED" | "REVOKED";
  }): Promise<SupportStudentAssignment> {
    const { identity } = input;
    assertStaffCapability(identity, "student_support_assignment.manage");

    const updated = await this.assignments.transitionStatus(
      input.id,
      identity.tenantId,
      input.targetStatus,
      input.targetStatus === "REVOKED" ? identity.staffAccountId : null,
    );
    if (!updated) {
      const existing = await this.assignments.findByPublicId(input.id, identity.tenantId);
      if (!existing) {
        throw new StaffIdentityError("VALIDATION_ERROR", "support_student_assignment not found.");
      }
      throw new StaffIdentityError("SUPPORT_ASSIGNMENT_INACTIVE");
    }

    await this.audit.record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: "student_support.unassigned",
      targetType: "support_student_assignment",
      targetId: updated.id,
      result: "SUCCESS",
      metadataRedacted: { targetStatus: input.targetStatus },
    });
    return updated;
  }
}
