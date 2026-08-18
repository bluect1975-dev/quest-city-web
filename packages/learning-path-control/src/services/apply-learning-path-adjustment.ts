import type { PoolClient } from "pg";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { LearningPathPolicyRepository } from "../repository/learning-path-policy-repository";
import { resolveEffectiveAvailability, type LearningPathResourceType, type LearningPathState } from "../resolver/resolve-effective-availability";
import { toPoliciesByScope } from "./learning-path-policy-service";

/**
 * `POST /facilitation-proposals/{id}/review`, ACCEPT of a
 * LEARNING_PATH_ADJUSTMENT proposal (02_41 §23, OpenAPI v1.15.0
 * reviewFacilitationProposal). Called from inside
 * `FacilitationProposalService.reviewInTransaction`'s own transaction
 * (`@quest-city-web/student-support`) via its injected
 * `onAcceptLearningPathAdjustment` hook -- `client` is the SAME
 * transaction-bound connection as the proposal's own status transition,
 * never a second connection/transaction. A thrown error here rolls back
 * the whole review (the proposal's ACCEPT never commits without the
 * corresponding policy change taking effect).
 *
 * Deliberately NOT a call into `LearningPathPolicyService.create()`: that
 * method is pool-bound (its own `IdempotencyRecordRepository.begin/
 * complete/fail` cycle would be a second, nested idempotency wrapper
 * around a write that the caller's own `REVIEW_IDEMPOTENCY_SCOPE` already
 * covers end to end -- one mechanism per operation, AGENTS.md v4.30).
 * This function reuses only the two pieces of `create()`'s logic that
 * still apply here: the hard-lock check on ENABLED, and the upsert.
 */
export async function applyLearningPathAdjustmentAcceptance(
  client: PoolClient,
  input: {
    tenantId: string;
    studentProfileId: string;
    resourceType: LearningPathResourceType;
    resourceRef: string;
    requestedState: LearningPathState;
    requestedAlternativeContentRef: string | null;
    reviewerStaffAccountId: string;
    sourceProposalPublicId: string;
  },
): Promise<void> {
  const policies = new LearningPathPolicyRepository(client);
  const enrollments = new SchoolEnrollmentRepository(client);

  if (input.requestedState === "ENABLED") {
    const enrollment = await enrollments.findCurrentByStudent(input.studentProfileId, input.tenantId);
    const parentPolicies = await policies.findForResource(input.tenantId, input.resourceType, input.resourceRef, {
      classId: enrollment?.classId ?? null,
    });
    const resolution = resolveEffectiveAvailability({
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      policiesByScope: toPoliciesByScope(parentPolicies.filter((p) => p.scope !== "STUDENT")),
    });
    if (resolution.effectiveAvailability === "EFFECTIVE_UNAVAILABLE") {
      throw new StaffIdentityError("LEARNING_PATH_PARENT_DISABLED", `A higher scope (${resolution.sourceScope}) already restricts this resource.`);
    }
  }

  await policies.upsert({
    tenantId: input.tenantId,
    scope: "STUDENT",
    scopeClassId: null,
    scopeStudentProfileId: input.studentProfileId,
    resourceType: input.resourceType,
    resourceRef: input.resourceRef,
    state: input.requestedState,
    // TargetLearningPath (OpenAPI v1.15.0) carries no reasonCategory field
    // -- ASACOM/SUPPORT_TEACHER propose a resource+state, not a structured
    // reason. TEMPORARY_SUPPORT is the closest fit for a support-role-
    // originated adjustment; the source proposal is recorded in
    // reasonNotes for traceability, same discipline already used for a
    // DIFFICULTY accept's fallback reason string.
    reasonCategory: "TEMPORARY_SUPPORT",
    reasonNotes: `Da proposta accettata ${input.sourceProposalPublicId}`,
    alternativeContentRef: input.requestedState === "DISABLED_WITH_ALTERNATIVE" ? input.requestedAlternativeContentRef : null,
    deploymentYear: null,
    createdByStaffAccountId: input.reviewerStaffAccountId,
  });
}
