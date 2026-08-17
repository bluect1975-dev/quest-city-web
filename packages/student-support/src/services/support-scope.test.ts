import { describe, expect, it } from "vitest";
import type { StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { resolveStudentSupportScope, assertStudentSupportScope } from "./support-scope";
import type { SupportStudentAssignment } from "../repository/support-student-assignment-repository";
import type { SchoolEnrollment } from "@quest-city-web/identity";

/**
 * Fast-loop unit coverage for `resolveStudentSupportScope` (02_39 §6bis,
 * §11quinquies.4/§11sexies.4) -- pure branching logic against fake
 * repositories (no real database), complementing the real-Postgres
 * integration coverage in tests/integration/student-support-roles-*.
 */

function fakeIdentity(overrides: Partial<StaffInternalIdentity> & Pick<StaffInternalIdentity, "role">): StaffInternalIdentity {
  return {
    staffAccountId: "staff-1",
    tenantId: "tenant-1",
    staffTenantMembershipId: "membership-1",
    classScope: null,
    csrfTokenHash: "unused",
    sessionId: "unused",
    ...overrides,
  };
}

function fakeAssignment(overrides: Partial<SupportStudentAssignment> = {}): SupportStudentAssignment {
  return {
    id: "assignment-1",
    publicId: "ssa_test",
    tenantId: "tenant-1",
    staffTenantMembershipId: "membership-1",
    studentProfileId: "student-1",
    classId: null,
    status: "ACTIVE",
    startsAt: new Date(),
    endsAt: null,
    assignedByStaffAccountId: "admin-1",
    createdAt: new Date(),
    revokedAt: null,
    revokedByStaffAccountId: null,
    ...overrides,
  };
}

function fakeEnrollment(overrides: Partial<SchoolEnrollment> = {}): SchoolEnrollment {
  return {
    id: "enrollment-1",
    tenantId: "tenant-1",
    classId: "class-1",
    studentProfileId: "student-1",
    accessAlias: "alias",
    accessAliasNormalized: "alias",
    pinHash: "x",
    status: "ACTIVE",
    pathId: null,
    validFrom: new Date(),
    validUntil: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("resolveStudentSupportScope", () => {
  it("ASACOM: grants access only via an ACTIVE support_student_assignment, never falls back to class access", async () => {
    const identity = fakeIdentity({ role: "ASACOM" });
    const assignment = fakeAssignment();
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => assignment } as never,
      enrollments: { findByClassAndStudent: async () => { throw new Error("ASACOM must never query class enrollment"); } } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.supportAssignment).toBe(assignment);
    expect(scope.viaClassAccess).toBe(false);
  });

  it("ASACOM: no assignment found -> denied, no implicit scope (02_39 §4.3)", async () => {
    const identity = fakeIdentity({ role: "ASACOM" });
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => null } as never,
      enrollments: {} as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(() => assertStudentSupportScope(scope)).toThrow();
  });

  it("SUPPORT_TEACHER: grants access via ACTIVE support_student_assignment even without class access", async () => {
    const identity = fakeIdentity({ role: "SUPPORT_TEACHER", classScope: [] });
    const assignment = fakeAssignment();
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => assignment } as never,
      enrollments: { findByClassAndStudent: async () => null } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.supportAssignment).toBe(assignment);
  });

  it("SUPPORT_TEACHER: falls back to class access (contitolarità, 02_39 §3bis.2) when no support assignment exists", async () => {
    const identity = fakeIdentity({ role: "SUPPORT_TEACHER", classScope: ["class-1"] });
    const enrollment = fakeEnrollment();
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => null } as never,
      enrollments: { findByClassAndStudent: async () => enrollment } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.supportAssignment).toBeNull();
    expect(scope.viaClassAccess).toBe(true);
  });

  it("SUPPORT_TEACHER: neither support assignment nor class access -> denied", async () => {
    const identity = fakeIdentity({ role: "SUPPORT_TEACHER", classScope: ["class-1"] });
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => null } as never,
      enrollments: { findByClassAndStudent: async () => null } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(() => assertStudentSupportScope(scope)).toThrow();
  });

  it("TEACHER: class access only, no support_student_assignment lookup at all (reuses existing mechanism unmodified)", async () => {
    const identity = fakeIdentity({ role: "TEACHER", classScope: ["class-1"] });
    const enrollment = fakeEnrollment();
    let assignmentLookupCalled = false;
    const deps = {
      supportAssignments: {
        findActiveByMembershipAndStudent: async () => {
          assignmentLookupCalled = true;
          return null;
        },
      } as never,
      enrollments: { findByClassAndStudent: async () => enrollment } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.viaClassAccess).toBe(true);
    expect(assignmentLookupCalled).toBe(false);
  });

  it("SCHOOL_ADMIN/INDEPENDENT_EDUCATOR/PLATFORM_ADMIN: never an actor for this scope (denied unconditionally, no repository call)", async () => {
    const identity = fakeIdentity({ role: "SCHOOL_ADMIN", classScope: null });
    const deps = { supportAssignments: {} as never, enrollments: {} as never };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.supportAssignment).toBeNull();
    expect(scope.viaClassAccess).toBe(false);
  });

  it("A LEFT/ARCHIVED enrollment does not grant SUPPORT_TEACHER class access (only ACTIVE-equivalent enrollments count)", async () => {
    const identity = fakeIdentity({ role: "SUPPORT_TEACHER", classScope: ["class-1"] });
    const leftEnrollment = fakeEnrollment({ status: "LEFT" });
    const deps = {
      supportAssignments: { findActiveByMembershipAndStudent: async () => null } as never,
      enrollments: { findByClassAndStudent: async () => leftEnrollment } as never,
    };
    const scope = await resolveStudentSupportScope(identity, "student-1", deps);
    expect(scope.viaClassAccess).toBe(false);
  });
});
