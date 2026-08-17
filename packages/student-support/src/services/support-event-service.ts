import type { Pool } from "pg";
import { AuditRepository, StudentProfileRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository, LearningAttemptRepository } from "@quest-city-web/attempts";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { SupportStudentAssignmentRepository } from "../repository/support-student-assignment-repository";
import { SchoolEnrollmentRepository } from "@quest-city-web/identity";
import {
  LearningSupportEventRepository,
  type LearningSupportEvent,
  type SupportIntensity,
  type SupportType,
} from "../repository/learning-support-event-repository";
import { resolveStudentSupportScope, assertStudentSupportScope } from "./support-scope";

const IDEMPOTENCY_SCOPE = "learning_support_event_create";

/** Actor-role -> required capability, per role (02_39 §12: ASACOM/TEACHER/SUPPORT_TEACHER are all admitted actors; TEACHER needs no new capability, reuses existing class access). */
function requiredCapabilityFor(role: StaffInternalIdentity["role"]): "asacom.support.record" | "support_teacher.support.record" | null {
  if (role === "ASACOM") return "asacom.support.record";
  if (role === "SUPPORT_TEACHER") return "support_teacher.support.record";
  return null; // TEACHER: no capability gate, reuses class scope directly.
}

/**
 * `POST /asacom/support-events`, `POST /support-teacher/support-events`
 * (02_26 v1.16 §37.4). HUMAN_SUPPORT axis (02_39 §9, §12) -- append-only,
 * never a PATCH/PUT route. `GET /students/{id}/support-events` is one
 * shared read endpoint for all three admitted roles.
 */
export class SupportEventService {
  private readonly events: LearningSupportEventRepository;
  private readonly assignments: SupportStudentAssignmentRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly attempts: LearningAttemptRepository;
  private readonly students: StudentProfileRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.events = new LearningSupportEventRepository(pool);
    this.assignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.attempts = new LearningAttemptRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    learningAttemptId: string;
    supportType: SupportType;
    intensity: SupportIntensity;
    durationSeconds?: number | null;
    noteStructuredRef?: string | null;
    idempotencyKey: string;
  }): Promise<LearningSupportEvent> {
    const { identity } = input;
    const requiredCapability = requiredCapabilityFor(identity.role);
    if (requiredCapability) {
      assertStaffCapability(identity, requiredCapability);
    } else if (identity.role !== "TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "Role is not an admitted actor for learning_support_event (02_39 §12).");
    }

    const student = await this.students.findByPublicId(input.studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }

    const scope = await resolveStudentSupportScope(identity, student.id, { supportAssignments: this.assignments, enrollments: this.enrollments });
    assertStudentSupportScope(scope);

    const attempt = await this.attempts.findByIdAndTenant(input.learningAttemptId, identity.tenantId);
    if (!attempt || attempt.studentProfileId !== student.id) {
      throw new StaffIdentityError("SUPPORT_EVENT_INVALID_ATTEMPT");
    }
    // A support event may be logged while IN_PROGRESS (real-time) or after
    // a terminal state (post-hoc, within reason) -- never against a
    // CREATED attempt with no real activity yet (02_39 §9).
    if (attempt.attemptState === "CREATED") {
      throw new StaffIdentityError("SUPPORT_EVENT_INVALID_ATTEMPT");
    }

    const scopeKey = `${input.learningAttemptId}:${identity.staffAccountId}:${input.idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ supportType: input.supportType, intensity: input.intensity }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as LearningSupportEvent;
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
      const created = await this.events.create({
        tenantId: identity.tenantId,
        learningAttemptId: input.learningAttemptId,
        studentProfileId: student.id,
        actorStaffAccountId: identity.staffAccountId,
        actorRole: identity.role as "ASACOM" | "TEACHER" | "SUPPORT_TEACHER",
        supportType: input.supportType,
        intensity: input.intensity,
        durationSeconds: input.durationSeconds ?? null,
        noteStructuredRef: input.noteStructuredRef ?? null,
      });

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      const auditAction = identity.role === "ASACOM" ? "asacom.support_recorded" : identity.role === "SUPPORT_TEACHER" ? "support_teacher.support_recorded" : "teacher.support_recorded";
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: auditAction,
        targetType: "learning_support_event",
        targetId: created.id,
        result: "SUCCESS",
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

  /** `GET /students/{studentPublicId}/support-events` (02_26 v1.16 §37.4) -- one shared endpoint. */
  async listByStudent(
    identity: StaffInternalIdentity,
    studentPublicId: string,
    pagination: { limit: number; offset: number },
  ): Promise<LearningSupportEvent[]> {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    const scope = await resolveStudentSupportScope(identity, student.id, { supportAssignments: this.assignments, enrollments: this.enrollments });
    assertStudentSupportScope(scope);
    const events = await this.events.findByStudent(student.id, identity.tenantId, pagination);
    return events.map((event) => ({ ...event, studentProfileId: student.studentPublicId }));
  }
}
