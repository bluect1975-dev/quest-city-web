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

const ASACOM_CAPABILITIES: StaffCapability[] = [
  "asacom.read.assigned_students",
  "asacom.support.record",
  "asacom.observation.record",
  "asacom.facilitation.read",
  "asacom.facilitation.apply",
  "asacom.facilitation.propose",
  "asacom.difficulty.propose",
  "asacom.progress.read.assigned",
];

const SUPPORT_TEACHER_CAPABILITIES: StaffCapability[] = [
  "support_teacher.support.record",
  "support_teacher.observation.record",
  "support_teacher.facilitation.read",
  "support_teacher.facilitation.apply",
  "support_teacher.difficulty.apply",
  "support_teacher.progress.read.assigned",
];

describe("hasStaffCapability / assertStaffCapability -- ASACOM and SUPPORT_TEACHER (02_39 v1.2 §24, 02_35 v1.7 §11quinquies.5/§11sexies.5)", () => {
  it("ASACOM holds exactly its own 8 capabilities, never SUPPORT_TEACHER's, TEACHER's, or SCHOOL_ADMIN's", () => {
    const asacom = identity("ASACOM");
    for (const capability of ASACOM_CAPABILITIES) {
      expect(hasStaffCapability(asacom, capability)).toBe(true);
    }
    for (const capability of [...SUPPORT_TEACHER_CAPABILITIES, ...SHARED_MANAGEMENT_CAPABILITIES, ...SCHOOL_ADMIN_ONLY_CAPABILITIES]) {
      expect(hasStaffCapability(asacom, capability)).toBe(false);
    }
  });

  it("SUPPORT_TEACHER holds exactly its own 6 capabilities, never ASACOM's -- two disjoint professional mandates, never TEACHER minus/plus a few (02_39 §1, §3)", () => {
    const supportTeacher = identity("SUPPORT_TEACHER");
    for (const capability of SUPPORT_TEACHER_CAPABILITIES) {
      expect(hasStaffCapability(supportTeacher, capability)).toBe(true);
    }
    for (const capability of [...ASACOM_CAPABILITIES, ...SHARED_MANAGEMENT_CAPABILITIES, ...SCHOOL_ADMIN_ONLY_CAPABILITIES]) {
      expect(hasStaffCapability(supportTeacher, capability)).toBe(false);
    }
  });

  it("student_support_assignment.manage is SCHOOL_ADMIN-only -- never ASACOM, never SUPPORT_TEACHER (no self-assignment)", () => {
    expect(hasStaffCapability(identity("SCHOOL_ADMIN"), "student_support_assignment.manage")).toBe(true);
    expect(hasStaffCapability(identity("ASACOM"), "student_support_assignment.manage")).toBe(false);
    expect(hasStaffCapability(identity("SUPPORT_TEACHER"), "student_support_assignment.manage")).toBe(false);
  });

  it("TEACHER's own capability set is unaffected by the two new roles -- ASACOM/SUPPORT_TEACHER never fall through to the TEACHER branch", () => {
    const teacher = identity("TEACHER");
    for (const capability of [...ASACOM_CAPABILITIES, ...SUPPORT_TEACHER_CAPABILITIES]) {
      expect(hasStaffCapability(teacher, capability)).toBe(false);
    }
  });

  it("assertStaffCapability throws STAFF_FORBIDDEN for ASACOM attempting a SUPPORT_TEACHER-only capability", () => {
    try {
      assertStaffCapability(identity("ASACOM"), "support_teacher.difficulty.apply");
      throw new Error("expected assertStaffCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StaffIdentityError);
      expect((error as StaffIdentityError).code).toBe("STAFF_FORBIDDEN");
    }
  });
});

const GLPC_TEACHER_CAPABILITIES: StaffCapability[] = [
  "learning_path.class.manage",
  "learning_path.student.manage",
  "learning_path.preview",
  "learning_path.alternative.assign",
  "learning_path.waiver.manage",
];

const GLPC_SUPPORT_TEACHER_CAPABILITIES: StaffCapability[] = [
  "learning_path.student.manage",
  "learning_path.student.propose",
  "learning_path.preview",
  "learning_path.alternative.assign",
  "learning_path.waiver.manage",
];

describe("hasStaffCapability / assertStaffCapability -- Granular Learning Path Control (02_41 v1.1 §44-45, migration 0013)", () => {
  it("SCHOOL_ADMIN holds every learning_path.* capability, including .school.manage (the only role that does, via the unconditional SCHOOL_ADMIN fallthrough)", () => {
    const admin = identity("SCHOOL_ADMIN");
    for (const capability of ["learning_path.school.manage", ...GLPC_TEACHER_CAPABILITIES, "learning_path.student.propose"] as StaffCapability[]) {
      expect(hasStaffCapability(admin, capability)).toBe(true);
    }
  });

  it("TEACHER holds class/student.manage/preview/alternative.assign/waiver.manage, classScope-limited, never .school.manage or .student.propose", () => {
    const teacher = identity("TEACHER");
    for (const capability of GLPC_TEACHER_CAPABILITIES) {
      expect(hasStaffCapability(teacher, capability)).toBe(true);
    }
    expect(hasStaffCapability(teacher, "learning_path.school.manage")).toBe(false);
    expect(hasStaffCapability(teacher, "learning_path.student.propose")).toBe(false);
  });

  it("SUPPORT_TEACHER holds the same five as TEACHER plus .student.propose, never .school.manage or .class.manage (support_student_assignment/class-roster scoped at the service layer, not here)", () => {
    const supportTeacher = identity("SUPPORT_TEACHER");
    for (const capability of GLPC_SUPPORT_TEACHER_CAPABILITIES) {
      expect(hasStaffCapability(supportTeacher, capability)).toBe(true);
    }
    expect(hasStaffCapability(supportTeacher, "learning_path.school.manage")).toBe(false);
    expect(hasStaffCapability(supportTeacher, "learning_path.class.manage")).toBe(false);
  });

  it("ASACOM holds ONLY learning_path.student.propose (PROPOSE_ONLY, 02_41 §22) -- never .manage/.preview/.alternative.assign/.waiver.manage, so ASACOM can never directly APPLY a GLPC change", () => {
    const asacom = identity("ASACOM");
    expect(hasStaffCapability(asacom, "learning_path.student.propose")).toBe(true);
    for (const capability of [
      "learning_path.school.manage",
      "learning_path.class.manage",
      "learning_path.student.manage",
      "learning_path.preview",
      "learning_path.alternative.assign",
      "learning_path.waiver.manage",
    ] as StaffCapability[]) {
      expect(hasStaffCapability(asacom, capability)).toBe(false);
    }
  });

  it("INDEPENDENT_EDUCATOR holds no learning_path.* capability at all (not part of the 02_41 role model)", () => {
    const ie = identity("INDEPENDENT_EDUCATOR");
    for (const capability of ["learning_path.school.manage", ...GLPC_TEACHER_CAPABILITIES, "learning_path.student.propose"] as StaffCapability[]) {
      expect(hasStaffCapability(ie, capability)).toBe(false);
    }
  });

  it("assertStaffCapability throws STAFF_FORBIDDEN for ASACOM attempting learning_path.student.manage (direct APPLY, forbidden by §22)", () => {
    try {
      assertStaffCapability(identity("ASACOM"), "learning_path.student.manage");
      throw new Error("expected assertStaffCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StaffIdentityError);
      expect((error as StaffIdentityError).code).toBe("STAFF_FORBIDDEN");
    }
  });

  it("assertStaffCapability throws STAFF_FORBIDDEN for TEACHER attempting learning_path.school.manage", () => {
    try {
      assertStaffCapability(identity("TEACHER"), "learning_path.school.manage");
      throw new Error("expected assertStaffCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StaffIdentityError);
      expect((error as StaffIdentityError).code).toBe("STAFF_FORBIDDEN");
    }
  });
});
