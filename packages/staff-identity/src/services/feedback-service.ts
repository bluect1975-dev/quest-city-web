import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { AssignmentRepository, IdempotencyRecordRepository, LearningAttemptRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { TeacherFeedbackRepository, type TeacherFeedback } from "../repository/teacher-feedback-repository";
import { ReviewQueueItemRepository } from "../repository/review-queue-item-repository";
import type { StaffInternalIdentity } from "./staff-auth-service";
import { isClassInScope } from "./authorization";

const CREATE_SCOPE = "staff_feedback_create";
const PUBLISH_SCOPE = "staff_feedback_publish";
const REVOKE_SCOPE = "staff_feedback_revoke";

function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/**
 * `POST /attempts/{attemptId}/feedback`, `POST /feedback/{feedbackId}/
 * publish`, `POST /feedback/{feedbackId}/revoke` (02_35 §9). `freeText` is
 * never sent anywhere by this service — this package has no delivery
 * mechanism to the Roblox runtime at all (WEB-M3B does not implement
 * Roblox feedback delivery).
 */
export class FeedbackService {
  private readonly attempts: LearningAttemptRepository;
  private readonly assignments: AssignmentRepository;
  private readonly feedback: TeacherFeedbackRepository;
  private readonly reviewItems: ReviewQueueItemRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.attempts = new LearningAttemptRepository(pool);
    this.assignments = new AssignmentRepository(pool);
    this.feedback = new TeacherFeedbackRepository(pool);
    this.reviewItems = new ReviewQueueItemRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  private async resolveAttemptScope(
    identity: StaffInternalIdentity,
    attemptId: string,
  ): Promise<{ classId: string; studentProfileId: string }> {
    const attempt = await this.attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    const assignment = await this.assignments.findByIdAndTenant(attempt.assignmentId, identity.tenantId);
    if (!assignment || !isClassInScope(identity, assignment.classId)) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    return { classId: assignment.classId, studentProfileId: attempt.studentProfileId };
  }

  async create(input: {
    identity: StaffInternalIdentity;
    attemptId: string;
    structuredFeedback: Record<string, unknown>;
    freeText: string | null;
    originReviewQueueItemId: string | null;
    idempotencyKey: string;
  }): Promise<TeacherFeedback> {
    const { identity, attemptId, idempotencyKey } = input;
    const { classId, studentProfileId } = await this.resolveAttemptScope(identity, attemptId);

    const scopeKey = `${attemptId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: CREATE_SCOPE,
      scopeKey,
      requestHash: hashOf({
        structuredFeedback: input.structuredFeedback,
        freeText: input.freeText,
        originReviewQueueItemId: input.originReviewQueueItemId,
      }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as TeacherFeedback;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD" || begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const created = await this.feedback.create({
        tenantId: identity.tenantId,
        classId,
        studentProfileId,
        learningAttemptId: attemptId,
        authorStaffAccountId: identity.staffAccountId,
        structuredFeedback: input.structuredFeedback,
        freeText: input.freeText,
        originReviewQueueItemId: input.originReviewQueueItemId,
      });
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_feedback_created",
        targetType: "teacher_feedback",
        targetId: created.id,
        result: "SUCCESS",
      });
      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /** DRAFT -> PUBLISHED. Implicitly resolves the linked review_queue_item if present (02_35 §9.4). */
  async publish(input: {
    identity: StaffInternalIdentity;
    feedbackId: string;
    ifMatchVersion: number;
    idempotencyKey: string;
  }): Promise<TeacherFeedback> {
    const { identity, feedbackId, ifMatchVersion, idempotencyKey } = input;
    const existing = await this.feedback.findById(feedbackId, identity.tenantId);
    if (!existing || !isClassInScope(identity, existing.classId)) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    if (existing.publicationStatus !== "DRAFT") {
      throw new StaffIdentityError("FEEDBACK_NOT_PUBLISHABLE");
    }

    const scopeKey = `${feedbackId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: PUBLISH_SCOPE,
      scopeKey,
      requestHash: hashOf({ action: "publish" }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as TeacherFeedback;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD" || begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const updated = await this.feedback.publish(feedbackId, identity.tenantId, ifMatchVersion);
      if (!updated) {
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: PUBLISH_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: "version_mismatch_or_not_draft" },
        });
        const current = await this.feedback.findById(feedbackId, identity.tenantId);
        if (current && current.version !== ifMatchVersion) {
          throw new StaffIdentityError("ETAG_MISMATCH", "If-Match non corrisponde alla versione corrente.");
        }
        throw new StaffIdentityError("FEEDBACK_NOT_PUBLISHABLE");
      }

      if (updated.originReviewQueueItemId) {
        const item = await this.reviewItems.findById(updated.originReviewQueueItemId, identity.tenantId);
        if (item && item.status !== "RESOLVED" && item.status !== "DISMISSED") {
          await this.reviewItems.transitionStatus(item.id, identity.tenantId, item.version, "RESOLVED", identity.staffAccountId);
        }
      }

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: PUBLISH_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: updated,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_feedback_published",
        targetType: "teacher_feedback",
        targetId: feedbackId,
        result: "SUCCESS",
      });
      return updated;
    } catch (error) {
      if (!(error instanceof StaffIdentityError)) {
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: PUBLISH_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: error instanceof Error ? error.message : String(error) },
        });
      }
      throw error;
    }
  }

  /** PUBLISHED -> REVOKED. deliveryStatus is not reset retroactively (02_35 §9.2). */
  async revoke(input: {
    identity: StaffInternalIdentity;
    feedbackId: string;
    ifMatchVersion: number;
    idempotencyKey: string;
  }): Promise<TeacherFeedback> {
    const { identity, feedbackId, ifMatchVersion, idempotencyKey } = input;
    const existing = await this.feedback.findById(feedbackId, identity.tenantId);
    if (!existing || !isClassInScope(identity, existing.classId)) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    if (existing.publicationStatus !== "PUBLISHED") {
      throw new StaffIdentityError("FEEDBACK_ALREADY_REVOKED");
    }

    const scopeKey = `${feedbackId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: REVOKE_SCOPE,
      scopeKey,
      requestHash: hashOf({ action: "revoke" }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as TeacherFeedback;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD" || begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const updated = await this.feedback.revoke(feedbackId, identity.tenantId, ifMatchVersion);
      if (!updated) {
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: REVOKE_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: "version_mismatch_or_not_published" },
        });
        const current = await this.feedback.findById(feedbackId, identity.tenantId);
        if (current && current.version !== ifMatchVersion) {
          throw new StaffIdentityError("ETAG_MISMATCH", "If-Match non corrisponde alla versione corrente.");
        }
        throw new StaffIdentityError("FEEDBACK_ALREADY_REVOKED");
      }

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: REVOKE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: updated,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_feedback_revoked",
        targetType: "teacher_feedback",
        targetId: feedbackId,
        result: "SUCCESS",
      });
      return updated;
    } catch (error) {
      if (!(error instanceof StaffIdentityError)) {
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: REVOKE_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: error instanceof Error ? error.message : String(error) },
        });
      }
      throw error;
    }
  }
}
