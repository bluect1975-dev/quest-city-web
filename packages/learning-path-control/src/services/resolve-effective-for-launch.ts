import type { Pool, PoolClient } from "pg";
import { SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { LearningPathPolicyRepository } from "../repository/learning-path-policy-repository";
import { resolveEffectiveAvailability, type EffectiveResolution, type LearningPathResourceType } from "../resolver/resolve-effective-availability";
import { toPoliciesByScope } from "./learning-path-policy-service";

/**
 * Server/system-triggered resolution for the student attempt-launch path
 * (02_41 §33-34, mission §25-29 "learning_path_snapshot captured at
 * attempt start"). Deliberately NOT `LearningPathPolicyService.resolveEffective`
 * -- that method is shaped for staff-authenticated callers
 * (`StaffInternalIdentity`, `learning_path.preview` capability check) and a
 * student launching their own content has no staff capabilities at all.
 * This is a pure system resolution: given a tenant+student+resource, it
 * resolves PLATFORM/SCHOOL/the student's current CLASS/STUDENT exactly as
 * the staff-facing resolver does, with no authorization check of its own
 * -- the caller (the launch route) is the one deciding who may launch,
 * this only answers "is it effectively available."
 */
export async function resolveEffectiveForLaunch(
  db: Pool | PoolClient,
  input: { tenantId: string; studentProfileId: string; resourceType: LearningPathResourceType; resourceRef: string },
): Promise<EffectiveResolution> {
  const policies = new LearningPathPolicyRepository(db);
  const enrollments = new SchoolEnrollmentRepository(db);
  const enrollment = await enrollments.findCurrentByStudent(input.studentProfileId, input.tenantId);
  const rows = await policies.findForResource(input.tenantId, input.resourceType, input.resourceRef, {
    classId: enrollment?.classId ?? null,
    studentProfileId: input.studentProfileId,
  });
  return resolveEffectiveAvailability({
    resourceType: input.resourceType,
    resourceRef: input.resourceRef,
    policiesByScope: toPoliciesByScope(rows),
  });
}
