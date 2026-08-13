import { describe, expect, it } from "vitest";
import { StaffIdentityError } from "../errors";
import { assertStaffCapability, hasStaffCapability, type StaffCapability } from "./capability";
import type { StaffInternalIdentity } from "./staff-auth-service";

function identity(role: StaffInternalIdentity["role"]): StaffInternalIdentity {
  return {
    staffAccountId: "staff-1",
    tenantId: "tenant-1",
    staffTenantMembershipId: "membership-1",
    role,
    classScope: role === "TEACHER" ? [] : null,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: "session-unused-in-these-tests",
  };
}

const SCHOOL_ADMIN_ONLY_CAPABILITIES: StaffCapability[] = [
  "staff.invite",
  "staff.member.read",
  "staff.membership.suspend",
  "staff.membership.revoke",
  "class.teacher.assign",
];

const SHARED_MANAGEMENT_CAPABILITIES: StaffCapability[] = ["class.create", "class.manage", "roster.manage", "assignment.create"];

describe("hasStaffCapability / assertStaffCapability -- INDEPENDENT_EDUCATOR (02_35 v1.4 §11ter.5)", () => {
  it("holds class.create/class.manage/roster.manage/assignment.create tenant-wide, same as SCHOOL_ADMIN", () => {
    const ie = identity("INDEPENDENT_EDUCATOR");
    for (const capability of SHARED_MANAGEMENT_CAPABILITIES) {
      expect(hasStaffCapability(ie, capability)).toBe(true);
    }
  });

  it("never holds staff.invite/staff.member.read/staff.membership.suspend/staff.membership.revoke/class.teacher.assign (§11ter.9: no co-educator invitation in this tranche)", () => {
    const ie = identity("INDEPENDENT_EDUCATOR");
    for (const capability of SCHOOL_ADMIN_ONLY_CAPABILITIES) {
      expect(hasStaffCapability(ie, capability)).toBe(false);
    }
  });

  it("SCHOOL_ADMIN still holds every capability (unaffected by the new role)", () => {
    const admin = identity("SCHOOL_ADMIN");
    for (const capability of [...SHARED_MANAGEMENT_CAPABILITIES, ...SCHOOL_ADMIN_ONLY_CAPABILITIES]) {
      expect(hasStaffCapability(admin, capability)).toBe(true);
    }
  });

  it("TEACHER's capability set is unaffected by the new role (roster.manage/assignment.create only)", () => {
    const teacher = identity("TEACHER");
    expect(hasStaffCapability(teacher, "roster.manage")).toBe(true);
    expect(hasStaffCapability(teacher, "assignment.create")).toBe(true);
    expect(hasStaffCapability(teacher, "class.create")).toBe(false);
    expect(hasStaffCapability(teacher, "staff.invite")).toBe(false);
  });

  it("assertStaffCapability throws STAFF_FORBIDDEN for an INDEPENDENT_EDUCATOR attempting staff.invite", () => {
    try {
      assertStaffCapability(identity("INDEPENDENT_EDUCATOR"), "staff.invite");
      throw new Error("expected assertStaffCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StaffIdentityError);
      expect((error as StaffIdentityError).code).toBe("STAFF_FORBIDDEN");
    }
  });

  it("assertStaffCapability does not throw for an INDEPENDENT_EDUCATOR performing class.create", () => {
    expect(() => assertStaffCapability(identity("INDEPENDENT_EDUCATOR"), "class.create")).not.toThrow();
  });
});
