import type { Pool } from "pg";
import { AuditRepository, StudentProfileRepository, SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { SupportStudentAssignmentRepository } from "../repository/support-student-assignment-repository";
import {
  LearningSupportObservationRepository,
  type LearningSupportObservation,
  type ObservationActorRole,
} from "../repository/learning-support-observation-repository";
import type { SupportType } from "../repository/learning-support-event-repository";
import { resolveStudentSupportScope, assertStudentSupportScope } from "./support-scope";

const IDEMPOTENCY_SCOPE = "learning_support_observation_create";

export interface ObservationHistoryEntry extends LearningSupportObservation {
  historyStatus: "CURRENT" | "SUPERSEDED";
  supersedesId: string | null;
}

function requiredCapabilityFor(role: StaffInternalIdentity["role"]): "asacom.observation.record" | "support_teacher.observation.record" {
  if (role === "ASACOM") return "asacom.observation.record";
  if (role === "SUPPORT_TEACHER") return "support_teacher.observation.record";
  // TEACHER is never an admitted actor for observations (02_39 §41) --
  // fall through to a capability guaranteed to fail for TEACHER, so the
  // caller gets a clean STAFF_FORBIDDEN rather than a silent bypass.
  return "asacom.observation.record";
}

/**
 * `POST /asacom/observations`, `POST /support-teacher/observations`,
 * `POST .../observations/{id}/supersede` (02_26 v1.16 §37.5), `GET
 * /students/{studentPublicId}/support-observations` (02_26 v1.17 §38.1).
 * `TEACHER` is never an actor here (02_39 §41) -- read-only consumer via
 * the shared timeline instead.
 */
export class ObservationService {
  private readonly observations: LearningSupportObservationRepository;
  private readonly assignments: SupportStudentAssignmentRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly students: StudentProfileRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.observations = new LearningSupportObservationRepository(pool);
    this.assignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    category?: SupportType | null | undefined;
    noteStructuredRef?: string | null;
    idempotencyKey: string;
  }): Promise<LearningSupportObservation> {
    const { identity } = input;
    if (identity.role !== "ASACOM" && identity.role !== "SUPPORT_TEACHER") {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "Role is not an admitted actor for learning_support_observation (02_39 §41).");
    }
    assertStaffCapability(identity, requiredCapabilityFor(identity.role));

    const student = await this.students.findByPublicId(input.studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    // Observations require an ACTIVE support_student_assignment
    // specifically (§10: `support_student_assignment_id` is a mandatory
    // FK) -- SUPPORT_TEACHER's class-only access is not sufficient here,
    // unlike support events.
    const assignment = await this.assignments.findActiveByMembershipAndStudent(identity.staffTenantMembershipId, student.id, identity.tenantId);
    if (!assignment) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ studentProfileId: student.id, category: input.category ?? null }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as LearningSupportObservation;
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
      const created = await this.observations.create({
        tenantId: identity.tenantId,
        studentProfileId: student.id,
        supportStudentAssignmentId: assignment.id,
        actorStaffAccountId: identity.staffAccountId,
        actorRole: identity.role as ObservationActorRole,
        category: input.category ?? null,
        noteStructuredRef: input.noteStructuredRef ?? null,
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
        action: identity.role === "ASACOM" ? "asacom.observation_recorded" : "support_teacher.observation_recorded",
        targetType: "learning_support_observation",
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

  /** `POST .../observations/{id}/supersede` -- author-only correction, append-only (never mutates the original's note content). */
  async supersede(input: {
    identity: StaffInternalIdentity;
    originalId: string;
    category?: SupportType | null | undefined;
    noteStructuredRef?: string | null;
    idempotencyKey: string;
  }): Promise<LearningSupportObservation> {
    const { identity } = input;
    // originalId is the public-facing id (the route param, always the
    // publicId in every response this service produces) -- never the raw
    // internal UUID primary key, which is never exposed to a caller.
    const original = await this.observations.findByPublicId(input.originalId, identity.tenantId);
    if (!original || original.actorStaffAccountId !== identity.staffAccountId) {
      throw new StaffIdentityError("VALIDATION_ERROR", "Observation not found or not authored by the caller.");
    }
    if (original.supersededById) {
      throw new StaffIdentityError("VALIDATION_ERROR", "Observation already superseded.");
    }

    const created = await this.create({
      identity,
      studentPublicId: (await this.students.findById(original.studentProfileId, identity.tenantId))?.studentPublicId ?? "",
      category: input.category ?? original.category,
      noteStructuredRef: input.noteStructuredRef ?? null,
      idempotencyKey: input.idempotencyKey,
    });
    await this.observations.markSuperseded(original.id, identity.tenantId, created.id);
    return created;
  }

  /** `GET /students/{studentPublicId}/support-observations` (02_26 v1.17 §38.1). historyStatus/supersedesId computed here, never persisted (single source of truth = superseded_by_id). */
  async listByStudent(
    identity: StaffInternalIdentity,
    studentPublicId: string,
    filter: { category?: SupportType | undefined; includeSuperseded: boolean },
    pagination: { limit: number; offset: number },
  ): Promise<ObservationHistoryEntry[]> {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    const scope = await resolveStudentSupportScope(identity, student.id, { supportAssignments: this.assignments, enrollments: this.enrollments });
    assertStudentSupportScope(scope);

    const rows = await this.observations.findByStudent(student.id, identity.tenantId, filter, pagination);
    // supersedesId = the reverse pointer: for each row, is there another
    // row in this page whose supersededById equals this row's id?
    const supersedesByTarget = new Map<string, string>();
    for (const row of rows) {
      if (row.supersededById) {
        supersedesByTarget.set(row.supersededById, row.id);
      }
    }
    return rows.map((row) => ({
      ...row,
      studentProfileId: student.studentPublicId,
      historyStatus: row.supersededById ? "SUPERSEDED" : "CURRENT",
      supersedesId: supersedesByTarget.get(row.id) ?? null,
    }));
  }
}
