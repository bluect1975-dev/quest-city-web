import { describe, expect, it } from "vitest";
import { StaffIdentityError } from "../errors";
import { assertClassInScope, isClassInScope } from "./authorization";
import type { StaffInternalIdentity } from "./staff-auth-service";

function teacher(classScope: string[]): StaffInternalIdentity {
  return {
    staffAccountId: "staff-1",
    tenantId: "tenant-1",
    staffTenantMembershipId: "membership-1",
    role: "TEACHER",
    classScope,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: "session-unused-in-these-tests",
  };
}

function schoolAdmin(): StaffInternalIdentity {
  return {
    staffAccountId: "staff-2",
    tenantId: "tenant-1",
    staffTenantMembershipId: "membership-2",
    role: "SCHOOL_ADMIN",
    classScope: null,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: "session-unused-in-these-tests",
  };
}

function independentEducator(): StaffInternalIdentity {
  return {
    staffAccountId: "staff-3",
    tenantId: "tenant-2",
    staffTenantMembershipId: "membership-3",
    role: "INDEPENDENT_EDUCATOR",
    classScope: null,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: "session-unused-in-these-tests",
  };
}

describe("isClassInScope / assertClassInScope (02_35 §3.2)", () => {
  it("SCHOOL_ADMIN is always in scope for any class in its tenant, regardless of classScope", () => {
    expect(isClassInScope(schoolAdmin(), "class-a")).toBe(true);
    expect(isClassInScope(schoolAdmin(), "class-does-not-exist")).toBe(true);
  });

  it("TEACHER is in scope only for classes in its explicit classScope list", () => {
    const identity = teacher(["class-a", "class-b"]);
    expect(isClassInScope(identity, "class-a")).toBe(true);
    expect(isClassInScope(identity, "class-b")).toBe(true);
    expect(isClassInScope(identity, "class-c")).toBe(false);
  });

  it("TEACHER with an empty classScope is out of scope for every class", () => {
    expect(isClassInScope(teacher([]), "class-a")).toBe(false);
  });

  it("INDEPENDENT_EDUCATOR is always in scope for any class in its own tenant, regardless of classScope (02_35 v1.4 §11ter.4, same tenant-wide pattern as SCHOOL_ADMIN)", () => {
    expect(isClassInScope(independentEducator(), "class-a")).toBe(true);
    expect(isClassInScope(independentEducator(), "class-does-not-exist")).toBe(true);
  });

  it("assertClassInScope does not throw when in scope", () => {
    expect(() => assertClassInScope(schoolAdmin(), "class-a")).not.toThrow();
    expect(() => assertClassInScope(teacher(["class-a"]), "class-a")).not.toThrow();
  });

  it("assertClassInScope throws CLASS_ACCESS_DENIED when out of scope", () => {
    try {
      assertClassInScope(teacher(["class-a"]), "class-b");
      throw new Error("expected assertClassInScope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StaffIdentityError);
      expect((error as StaffIdentityError).code).toBe("CLASS_ACCESS_DENIED");
      expect((error as StaffIdentityError).httpStatus).toBe(404);
    }
  });
});
