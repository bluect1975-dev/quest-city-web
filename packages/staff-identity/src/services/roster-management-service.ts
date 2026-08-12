import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AuditRepository,
  SchoolClassRepository,
  StudentProfileRepository,
  SchoolEnrollmentRepository,
  normalizeAlias,
  hashPin,
  generatePin,
  type SchoolEnrollmentStatus,
} from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { assertStaffCapability } from "./capability";
import { assertClassInScope } from "./authorization";
import type { StaffInternalIdentity } from "./staff-auth-service";

const SCOPE_ADD = "staff_roster_add";
const SCOPE_REMOVE = "staff_roster_remove";

export type RosterMode = "NEW" | "EXISTING";

export interface RosterMemberResult {
  studentProfileId: string;
  studentPublicId: string;
  classId: string;
  accessAlias: string;
  /** Present exactly once, in this response only — never returned by any other endpoint (02_35 §11bis.7). */
  pin: string | undefined;
  status: SchoolEnrollmentStatus;
  createdAt: string;
}

export interface RemoveRosterMemberResult {
  studentProfileId: string;
  classId: string;
  status: "LEFT";
}

function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/**
 * `POST/DELETE /classes/{classId}/students` (02_35 v1.2 §11bis.7).
 * `mode=NEW` creates a fresh `student_profile` + `school_enrollment`;
 * `mode=EXISTING` creates only a new `school_enrollment` for a
 * `student_profile` the operator explicitly names — never a name/email
 * heuristic match (02_38 §9 principle, applied by analogy). Removal is
 * always a soft transition to `LEFT`, never a delete — `student_profile`,
 * `learning_attempt`, `mastery_state` and all historical evidence key off
 * `student_profile_id`, never `enrollment_id`, and are entirely
 * unaffected.
 */
export class RosterManagementService {
  private readonly classes: SchoolClassRepository;
  private readonly students: StudentProfileRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.classes = new SchoolClassRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async addStudent(input: {
    identity: StaffInternalIdentity;
    classId: string;
    mode: RosterMode;
    studentPublicId: string | undefined;
    accessAlias: string;
    pin: string | undefined;
    idempotencyKey: string;
  }): Promise<RosterMemberResult> {
    const { identity, classId, mode, accessAlias } = input;
    assertStaffCapability(identity, "roster.manage");
    assertClassInScope(identity, classId);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: SCOPE_ADD,
      scopeKey,
      requestHash: requestHashOf({ classId, mode, studentPublicId: input.studentPublicId, accessAlias }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as RosterMemberResult;
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
      const schoolClass = await this.classes.findById(classId, identity.tenantId);
      if (!schoolClass) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }

      let studentProfile;
      if (mode === "EXISTING") {
        if (!input.studentPublicId) {
          throw new StaffIdentityError("VALIDATION_ERROR", "studentPublicId is required when mode=EXISTING.");
        }
        const found = await this.students.findByPublicId(input.studentPublicId);
        studentProfile = found && found.tenantId === identity.tenantId ? found : null;
        if (!studentProfile) {
          throw new StaffIdentityError("STUDENT_NOT_FOUND");
        }
      } else {
        const studentPublicId = `stu_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
        studentProfile = await this.students.create({ tenantId: identity.tenantId, studentPublicId, status: "ACTIVE" });
      }

      const aliasNormalized = normalizeAlias(accessAlias);
      const aliasCollision = await this.enrollments.findByClassAndAliasNormalized(classId, aliasNormalized);
      if (aliasCollision) {
        throw new StaffIdentityError("STUDENT_ALREADY_ENROLLED");
      }
      const sameStudentInClass = await this.enrollments.findByClassAndStudent(classId, studentProfile.id, identity.tenantId);
      if (sameStudentInClass) {
        throw new StaffIdentityError("STUDENT_ALREADY_ENROLLED");
      }

      const plaintextPin = input.pin ?? generatePin();
      const pinHash = await hashPin(plaintextPin);

      // Staff-driven roster entries are immediately usable — no separate
      // self-service acceptance step is defined anywhere in this
      // contract for roster entries (unlike staff invitations, which do
      // have an explicit accept step).
      const enrollment = await this.enrollments.create({
        tenantId: identity.tenantId,
        classId,
        studentProfileId: studentProfile.id,
        accessAlias,
        accessAliasNormalized: aliasNormalized,
        pinHash,
        status: "ACTIVE",
      });

      const result: RosterMemberResult = {
        studentProfileId: studentProfile.id,
        studentPublicId: studentProfile.studentPublicId,
        classId,
        accessAlias: enrollment.accessAlias,
        pin: plaintextPin,
        status: enrollment.status,
        createdAt: enrollment.createdAt.toISOString(),
      };

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: SCOPE_ADD,
        scopeKey,
        expectedGeneration: begin.generation,
        // Never persist the plaintext PIN in the idempotency-record replay cache.
        response: { ...result, pin: "[REDACTED]" },
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "roster_student_added",
        targetType: "school_enrollment",
        targetId: enrollment.id,
        result: "SUCCESS",
        metadataRedacted: { mode },
      });

      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: SCOPE_ADD,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async removeStudent(input: {
    identity: StaffInternalIdentity;
    classId: string;
    studentProfileId: string;
    idempotencyKey: string;
  }): Promise<RemoveRosterMemberResult> {
    const { identity, classId, studentProfileId } = input;
    assertStaffCapability(identity, "roster.manage");
    assertClassInScope(identity, classId);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: SCOPE_REMOVE,
      scopeKey,
      requestHash: requestHashOf({ classId, studentProfileId }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as RemoveRosterMemberResult;
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
      const schoolClass = await this.classes.findById(classId, identity.tenantId);
      if (!schoolClass) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      const enrollment = await this.enrollments.findByClassAndStudent(classId, studentProfileId, identity.tenantId);
      if (!enrollment) {
        throw new StaffIdentityError("STUDENT_NOT_FOUND");
      }
      if (enrollment.status === "LEFT" || enrollment.status === "ARCHIVED") {
        throw new StaffIdentityError("ENROLLMENT_NOT_ACTIVE");
      }
      const updated = await this.enrollments.setStatus(enrollment.id, identity.tenantId, "LEFT");
      if (!updated) throw new Error("school_enrollment: setStatus produced no row");

      const result: RemoveRosterMemberResult = { studentProfileId, classId, status: "LEFT" };
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: SCOPE_REMOVE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "roster_student_removed",
        targetType: "school_enrollment",
        targetId: enrollment.id,
        result: "SUCCESS",
      });
      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: SCOPE_REMOVE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
