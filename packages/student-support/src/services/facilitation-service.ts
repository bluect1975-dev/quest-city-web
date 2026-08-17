import type { Pool } from "pg";
import { AuditRepository, StudentProfileRepository, SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { SupportStudentAssignmentRepository } from "../repository/support-student-assignment-repository";
import {
  SupportProfileRepository,
  type SupportProfileEntry,
  type SupportProfileCategory,
} from "../repository/support-profile-repository";
import { DifficultyOverrideRepository, type DifficultyOverride } from "../repository/difficulty-override-repository";
import { resolveStudentSupportScope, assertStudentSupportScope } from "./support-scope";

const ASACOM_TEMPORARY_ONLY_CATEGORY: SupportProfileCategory = "TOOLS";
const SESSION_ONLY_TTL_MS = 4 * 60 * 60 * 1000; // 4h -- a single school session's worth, never persisted past it.
const DIFFICULTY_IDEMPOTENCY_SCOPE = "difficulty_override_create";
const SUPPORT_TEACHER_APPLY_IDEMPOTENCY_SCOPE = "support_teacher_facilitation_apply";

/**
 * `GET /students/{id}/facilitation`, `POST /asacom/facilitation/{id}/apply-temporary`,
 * `POST /support-teacher/facilitation/{id}/apply`, `POST
 * /support-teacher/difficulty-overrides` (02_26 v1.16 §37.6, 02_39 §7).
 * FACILITATION *is* the (minimal) support_profile model (§7.3) -- no
 * second axis-specific table. DIFFICULTY stays entirely separate
 * (difficulty_override), never confused with FACILITATION.
 */
export class FacilitationService {
  private readonly profiles: SupportProfileRepository;
  private readonly difficultyOverrides: DifficultyOverrideRepository;
  private readonly assignments: SupportStudentAssignmentRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly students: StudentProfileRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.profiles = new SupportProfileRepository(pool);
    this.difficultyOverrides = new DifficultyOverrideRepository(pool);
    this.assignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  /** `GET /students/{id}/facilitation` -- current ACTIVE state, both persistence levels, filtered to the caller's own scope. */
  async readByStudent(identity: StaffInternalIdentity, studentPublicId: string): Promise<SupportProfileEntry[]> {
    const student = await this.resolveScopedStudent(identity, studentPublicId, [
      "asacom.facilitation.read",
      "support_teacher.facilitation.read",
    ]);
    return this.profiles.findActiveByStudent(student.id, identity.tenantId);
  }

  /** `POST /asacom/facilitation/{studentPublicId}/apply-temporary` -- SESSION_ONLY, TOOLS category only, pre-approved categories only (02_39 §7.1). Never requires Idempotency-Key (non-persistent effect). */
  async asacomApplyTemporary(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    category: SupportProfileCategory;
    configJson: Record<string, unknown>;
  }): Promise<SupportProfileEntry> {
    const { identity } = input;
    if (identity.role !== "ASACOM") {
      throw new StaffIdentityError("STAFF_FORBIDDEN");
    }
    assertStaffCapability(identity, "asacom.facilitation.apply");
    if (input.category !== ASACOM_TEMPORARY_ONLY_CATEGORY) {
      throw new StaffIdentityError("FACILITATION_NOT_ALLOWED", "ASACOM may only apply SESSION_ONLY facilitation for the TOOLS category (02_39 §7.1).");
    }
    const student = await this.resolveScopedStudentForWrite(identity, input.studentPublicId);
    return this.profiles.apply({
      tenantId: identity.tenantId,
      studentProfileId: student.id,
      category: input.category,
      level: "SESSION_ONLY",
      configJson: input.configJson,
      appliedByStaffAccountId: identity.staffAccountId,
      appliedByRole: "ASACOM",
      expiresAt: new Date(Date.now() + SESSION_ONLY_TTL_MS),
    });
  }

  /**
   * `POST /support-teacher/facilitation/{studentPublicId}/apply` --
   * SESSION_ONLY or PROFILE_LEVEL, any of the seven categories, own
   * assigned students only (02_39 §7.1). Idempotency-Key required only
   * for PROFILE_LEVEL (persistent write).
   */
  async supportTeacherApply(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    category: SupportProfileCategory;
    level: "SESSION_ONLY" | "PROFILE_LEVEL";
    configJson: Record<string, unknown>;
    idempotencyKey?: string | undefined;
  }): Promise<SupportProfileEntry> {
    const { identity } = input;
    if (identity.role !== "SUPPORT_TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN");
    }
    assertStaffCapability(identity, "support_teacher.facilitation.apply");
    const student = await this.resolveScopedStudentForWrite(identity, input.studentPublicId);

    const apply = () =>
      this.profiles.apply({
        tenantId: identity.tenantId,
        studentProfileId: student.id,
        category: input.category,
        level: input.level,
        configJson: input.configJson,
        appliedByStaffAccountId: identity.staffAccountId,
        appliedByRole: "SUPPORT_TEACHER",
        expiresAt: input.level === "SESSION_ONLY" ? new Date(Date.now() + SESSION_ONLY_TTL_MS) : null,
      });

    if (input.level === "SESSION_ONLY") {
      const created = await apply();
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "support_teacher.facilitation_applied",
        targetType: "support_profile",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { level: "SESSION_ONLY", category: input.category },
      });
      return created;
    }

    if (!input.idempotencyKey) {
      throw new StaffIdentityError("VALIDATION_ERROR", "Idempotency-Key is required for PROFILE_LEVEL facilitation apply.");
    }
    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: SUPPORT_TEACHER_APPLY_IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ studentProfileId: student.id, category: input.category, configJson: input.configJson }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as SupportProfileEntry;
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
      const created = await apply();
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: SUPPORT_TEACHER_APPLY_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "support_teacher.facilitation_applied",
        targetType: "support_profile",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { level: "PROFILE_LEVEL", category: input.category },
      });
      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: SUPPORT_TEACHER_APPLY_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /** `POST /support-teacher/difficulty-overrides` -- per-student motivated/audited override (02_39 §7.2), own assigned students only. */
  async supportTeacherCreateDifficultyOverride(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    targetRef: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<DifficultyOverride> {
    const { identity } = input;
    if (identity.role !== "SUPPORT_TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN");
    }
    assertStaffCapability(identity, "support_teacher.difficulty.apply");
    const student = await this.resolveScopedStudentForWrite(identity, input.studentPublicId);
    if (!input.reason || input.reason.trim().length === 0) {
      throw new StaffIdentityError("VALIDATION_ERROR", "reason is required (motivated/audited override, 02_39 §7.2).");
    }

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: DIFFICULTY_IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ studentProfileId: student.id, targetRef: input.targetRef }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as DifficultyOverride;
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
      const created = await this.difficultyOverrides.createForStudent({
        tenantId: identity.tenantId,
        studentProfileId: student.id,
        targetRef: input.targetRef,
        reason: input.reason,
        createdByStaffAccountId: identity.staffAccountId,
        // Explicit, not identity.role: this is the direct-apply endpoint,
        // already gated to SUPPORT_TEACHER-only at the top of this method
        // -- never reachable by TEACHER, regardless of the relaxed DB
        // CHECK (migration 0012). Review-derived TEACHER writes only ever
        // happen through FacilitationProposalService.review().
        createdByRole: "SUPPORT_TEACHER",
      });
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: DIFFICULTY_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "support_teacher.difficulty_applied",
        targetType: "difficulty_override",
        targetId: created.id,
        result: "SUCCESS",
      });
      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: DIFFICULTY_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async resolveScopedStudent(
    identity: StaffInternalIdentity,
    studentPublicId: string,
    _capabilities: ("asacom.facilitation.read" | "support_teacher.facilitation.read")[],
  ) {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    if (identity.role === "ASACOM") {
      assertStaffCapability(identity, "asacom.facilitation.read");
    } else if (identity.role === "SUPPORT_TEACHER") {
      assertStaffCapability(identity, "support_teacher.facilitation.read");
    } else if (identity.role !== "TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN");
    }
    const scope = await resolveStudentSupportScope(identity, student.id, { supportAssignments: this.assignments, enrollments: this.enrollments });
    assertStudentSupportScope(scope);
    return student;
  }

  /** Write paths (apply/propose) always require the per-student support_student_assignment, never class-only access -- even for SUPPORT_TEACHER (02_39 §7.1: "propri studenti assegnati", the assignment relationship, not the class). */
  private async resolveScopedStudentForWrite(identity: StaffInternalIdentity, studentPublicId: string) {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    const assignment = await this.assignments.findActiveByMembershipAndStudent(identity.staffTenantMembershipId, student.id, identity.tenantId);
    if (!assignment) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    return student;
  }
}
