import type { TeacherFeedback } from "@quest-city-web/staff-identity";

/**
 * Maps a `TeacherFeedback` to the OpenAPI v1.6 `TeacherFeedback` schema
 * shape. Dates are re-wrapped with `new Date(...)` because a value
 * replayed from the idempotency cache (`DUPLICATE_SAME_PAYLOAD`) has
 * already round-tripped through JSON — its date fields are ISO strings,
 * not `Date` instances — while a freshly written value still carries real
 * `Date` objects; `new Date(x)` normalizes both to the same output.
 */
export function toTeacherFeedbackResponseData(feedback: TeacherFeedback) {
  return {
    id: feedback.id,
    tenantId: feedback.tenantId,
    classId: feedback.classId,
    studentProfileId: feedback.studentProfileId,
    learningAttemptId: feedback.learningAttemptId,
    authorStaffId: feedback.authorStaffAccountId,
    structuredFeedback: feedback.structuredFeedback,
    freeText: feedback.freeText,
    publicationStatus: feedback.publicationStatus,
    deliveryStatus: feedback.deliveryStatus,
    originReviewQueueItemId: feedback.originReviewQueueItemId,
    recoveryAssignmentId: feedback.recoveryAssignmentId,
    createdAt: new Date(feedback.createdAt).toISOString(),
    updatedAt: new Date(feedback.updatedAt).toISOString(),
    publishedAt: feedback.publishedAt ? new Date(feedback.publishedAt).toISOString() : null,
    revokedAt: feedback.revokedAt ? new Date(feedback.revokedAt).toISOString() : null,
    version: feedback.version,
  };
}
