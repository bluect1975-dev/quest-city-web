import { StaffIdentityError, isClassInScope, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { SupportStudentAssignmentRepository, type SupportStudentAssignment } from "../repository/support-student-assignment-repository";

export interface StudentSupportScopeResult {
  /** Present when access is granted via an ACTIVE support_student_assignment (ASACOM or SUPPORT_TEACHER). */
  supportAssignment: SupportStudentAssignment | null;
  /** True when access is granted via class scope alone (TEACHER, or SUPPORT_TEACHER's own assigned class -- 02_39 v1.1 §3bis.2). */
  viaClassAccess: boolean;
}

/**
 * Resolves whether the caller may access a specific student for Student
 * Support purposes (02_39 §6bis, §11quinquies.4/§11sexies.4). Never a
 * tenant-wide or role-wide grant -- always one of two explicit paths:
 *
 *  - ASACOM: ONLY an ACTIVE support_student_assignment referencing the
 *    caller's own membership. No implicit scope whatsoever (§4.3).
 *  - SUPPORT_TEACHER: an ACTIVE support_student_assignment (per-student
 *    support level), OR the student being enrolled in one of the
 *    caller's own assigned classes (staff_class_assignment, class-level
 *    contitolarità, §3bis.2) -- either path grants access.
 *  - TEACHER: the student being enrolled in one of the caller's own
 *    assigned classes only (existing mechanism, reused unmodified).
 *
 * Returns `{ supportAssignment: null, viaClassAccess: false }` (no
 * throw) when access is denied -- callers map this uniformly to
 * SUPPORT_STUDENT_NOT_ASSIGNED (or CLASS_ACCESS_DENIED for a pure class
 * read), anti-enumeration (§11quinquies.7/§11sexies.8): a nonexistent
 * student and an existing-but-out-of-scope student are indistinguishable
 * to the caller.
 */
export async function resolveStudentSupportScope(
  identity: StaffInternalIdentity,
  studentProfileId: string,
  deps: { supportAssignments: SupportStudentAssignmentRepository; enrollments: SchoolEnrollmentRepository },
): Promise<StudentSupportScopeResult> {
  if (identity.role === "ASACOM") {
    const assignment = await deps.supportAssignments.findActiveByMembershipAndStudent(
      identity.staffTenantMembershipId,
      studentProfileId,
      identity.tenantId,
    );
    return { supportAssignment: assignment, viaClassAccess: false };
  }

  if (identity.role === "SUPPORT_TEACHER") {
    const assignment = await deps.supportAssignments.findActiveByMembershipAndStudent(
      identity.staffTenantMembershipId,
      studentProfileId,
      identity.tenantId,
    );
    if (assignment) {
      return { supportAssignment: assignment, viaClassAccess: false };
    }
    const viaClass = await isStudentInCallerClassScope(identity, studentProfileId, deps.enrollments);
    return { supportAssignment: null, viaClassAccess: viaClass };
  }

  if (identity.role === "TEACHER") {
    const viaClass = await isStudentInCallerClassScope(identity, studentProfileId, deps.enrollments);
    return { supportAssignment: null, viaClassAccess: viaClass };
  }

  // SCHOOL_ADMIN/INDEPENDENT_EDUCATOR/PLATFORM_ADMIN are never actors for
  // Student Support read/write surfaces (02_39 §25: "usa visibilità
  // tenant-wide esistente" for other purposes, never this path) -- denied.
  return { supportAssignment: null, viaClassAccess: false };
}

async function isStudentInCallerClassScope(
  identity: StaffInternalIdentity,
  studentProfileId: string,
  enrollments: SchoolEnrollmentRepository,
): Promise<boolean> {
  const classScope = identity.classScope ?? [];
  for (const classId of classScope) {
    if (!isClassInScope(identity, classId)) continue;
    const enrollment = await enrollments.findByClassAndStudent(classId, studentProfileId, identity.tenantId);
    if (enrollment && enrollment.status !== "LEFT" && enrollment.status !== "ARCHIVED") {
      return true;
    }
  }
  return false;
}

/** Throws the uniform anti-enumeration 404 when scope resolution found nothing (02_39 §11quinquies.7/§11sexies.8). */
export function assertStudentSupportScope(scope: StudentSupportScopeResult): void {
  if (!scope.supportAssignment && !scope.viaClassAccess) {
    throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
  }
}
