import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import {
  AssignmentRepository,
  IdempotencyRecordRepository,
  LearningAttemptRepository,
  type Assignment,
} from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { TeacherFeedbackRepository } from "../repository/teacher-feedback-repository";
import type { StaffInternalIdentity } from "./staff-auth-service";
import { isClassInScope } from "./authorization";

const IDEMPOTENCY_SCOPE = "staff_recovery_assignment_create";

function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export interface RecoveryAssignmentResult {
  assignmentId: string;
  originTeacherFeedbackId: string;
  studentProfileId: string;
  contentBundleId: string;
  allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  status: Assignment["status"];
  createdByStaffId: string;
  createdAt: Date;
}

/**
 * `POST /attempts/{attemptId}/recovery-assignment` (02_35 §11). NOT
 * generic assignment authoring — the sole path is a row created in the
 * EXISTING `assignment` entity via the additive `origin_type` /
 * `target_student_profile_id` columns (migration 0004), restricted to the
 * single case of a recovery derived from a PUBLISHED teacher_feedback.
 * Verified not to conflict with AGENTS.md rule 16 (02_35 §11.1-11.2): this
 * package's staff identity/authorization/audit model is the precondition
 * rule 16 itself names for unblocking a narrowly-scoped exception.
 */
export class RecoveryAssignmentService {
  private readonly attempts: LearningAttemptRepository;
  private readonly assignments: AssignmentRepository;
  private readonly feedback: TeacherFeedbackRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.attempts = new LearningAttemptRepository(pool);
    this.assignments = new AssignmentRepository(pool);
    this.feedback = new TeacherFeedbackRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    attemptId: string;
    originTeacherFeedbackId: string;
    contentBundleId: string;
    allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
    idempotencyKey: string;
  }): Promise<RecoveryAssignmentResult> {
    const { identity, attemptId, originTeacherFeedbackId, idempotencyKey } = input;

    const attempt = await this.attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    const sourceAssignment = await this.assignments.findByIdAndTenant(attempt.assignmentId, identity.tenantId);
    if (!sourceAssignment || !isClassInScope(identity, sourceAssignment.classId)) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }

    const feedback = await this.feedback.findById(originTeacherFeedbackId, identity.tenantId);
    if (!feedback || feedback.learningAttemptId !== attemptId) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    if (feedback.publicationStatus !== "PUBLISHED") {
      throw new StaffIdentityError("RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED");
    }

    const scopeKey = `${attemptId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: hashOf({ originTeacherFeedbackId, contentBundleId: input.contentBundleId, allowedRuntimeChannels: input.allowedRuntimeChannels }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as RecoveryAssignmentResult;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD" || begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      // PUBLISHED immediately — a recovery assignment exists specifically
      // to give the student remedial content right away; there is no
      // separate staff-facing publish step for assignments in WEB-M3B
      // (only teacher_feedback has one).
      const created = await this.assignments.create({
        tenantId: identity.tenantId,
        classId: sourceAssignment.classId,
        publicId: `recovery-${randomUUID()}`,
        title: `Recupero — ${feedback.id.slice(0, 8)}`,
        status: "PUBLISHED",
        createdByActorType: "STAFF",
        createdByActorId: identity.staffAccountId,
        completionPolicy: "FIRST_VALID_COMPLETION",
        contentBundleId: input.contentBundleId,
        allowedRuntimeChannels: input.allowedRuntimeChannels,
        originType: "RECOVERY_FROM_REVIEW",
        targetStudentProfileId: attempt.studentProfileId,
      });
      await this.feedback.setRecoveryAssignment(feedback.id, identity.tenantId, created.id);

      const result: RecoveryAssignmentResult = {
        assignmentId: created.id,
        originTeacherFeedbackId: feedback.id,
        studentProfileId: attempt.studentProfileId,
        contentBundleId: created.contentBundleId,
        allowedRuntimeChannels: created.allowedRuntimeChannels,
        status: created.status,
        createdByStaffId: identity.staffAccountId,
        createdAt: created.createdAt,
      };

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_recovery_assignment_created",
        targetType: "assignment",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { originTeacherFeedbackId: feedback.id },
      });
      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
