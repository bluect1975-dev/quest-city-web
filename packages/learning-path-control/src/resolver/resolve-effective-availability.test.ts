import { describe, expect, it } from "vitest";
import { resolveEffectiveAvailability, type LearningPathPolicyInput } from "./resolve-effective-availability";

/**
 * Fast-loop unit coverage for the GLPC resolution algorithm (02_41 §31,
 * §44). Pure function, no database -- covers cascade/inheritance, hard
 * lock, shadowing, waiver, alternative, and the OPTIONAL_ENRICHMENT vs
 * CORE_LEARNING_ACTIVITY completion-semantics distinction (§25).
 */

function policy(overrides: Partial<LearningPathPolicyInput> & Pick<LearningPathPolicyInput, "id" | "scope" | "state">): LearningPathPolicyInput {
  return {
    reasonCategory: "SCHOOL_POLICY",
    alternativeContentRef: null,
    ...overrides,
  };
}

describe("resolveEffectiveAvailability", () => {
  it("defaults to EFFECTIVE_AVAILABLE when no policy exists at any scope (pure INHERIT)", () => {
    const result = resolveEffectiveAvailability({ resourceType: "UNIT", resourceRef: "u1", policiesByScope: {} });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_AVAILABLE");
    expect(result.sourceScope).toBe("PLATFORM");
    expect(result.sourcePolicyId).toBeNull();
  });

  it("mission example: PLATFORM available, SCHOOL disabled -> CLASS cannot re-enable -> STUDENT cannot re-enable", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "DISABLED" }),
        CLASS: policy({ id: "class-1", scope: "CLASS", state: "ENABLED" }),
        STUDENT: policy({ id: "student-1", scope: "STUDENT", state: "ENABLED" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.sourceScope).toBe("SCHOOL");
    expect(result.sourcePolicyId).toBe("school-1");
    expect(result.shadowedLowerScopePolicyIds).toEqual(["class-1", "student-1"]);
  });

  it("Class restricts further within School's envelope: School enabled, Class disabled", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "ENABLED" }),
        CLASS: policy({ id: "class-1", scope: "CLASS", state: "DISABLED" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.sourceScope).toBe("CLASS");
  });

  it("Student restricts further within Class's envelope", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ile-1",
      policiesByScope: {
        CLASS: policy({ id: "class-1", scope: "CLASS", state: "ENABLED" }),
        STUDENT: policy({ id: "student-1", scope: "STUDENT", state: "DISABLED" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.sourceScope).toBe("STUDENT");
  });

  it("UNAVAILABLE_FOR_USE at PLATFORM overrides every lower scope, even explicit ENABLED at all three", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        PLATFORM: policy({ id: "platform-1", scope: "PLATFORM", state: "UNAVAILABLE_FOR_USE" }),
        SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "ENABLED" }),
        CLASS: policy({ id: "class-1", scope: "CLASS", state: "ENABLED" }),
        STUDENT: policy({ id: "student-1", scope: "STUDENT", state: "ENABLED" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.sourceScope).toBe("PLATFORM");
    expect(result.shadowedLowerScopePolicyIds).toEqual(["school-1", "class-1", "student-1"]);
  });

  it("shadowing + re-enable (02_41 §11-12, mission §46): Class had ENABLED it; School later disables (shadows Class's ENABLED, per the exact example in 02_41 §11); School re-enables -> Class's own ENABLED becomes effective again, with no re-write of the Class row required", () => {
    const classEnabled = policy({ id: "class-1", scope: "CLASS", state: "ENABLED" });

    // Step 1: School disables -> hard lock (02_41 §10): Class's ENABLED cannot
    // win, and is recorded as shadowed rather than discarded (02_41 §11-12).
    const withSchoolDisabled = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "DISABLED" }),
        CLASS: classEnabled,
      },
    });
    expect(withSchoolDisabled.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(withSchoolDisabled.sourceScope).toBe("SCHOOL");
    expect(withSchoolDisabled.shadowedLowerScopePolicyIds).toEqual(["class-1"]);

    // Step 2: School re-enables (its row deleted, i.e. absent from policiesByScope
    // -- reverted to INHERIT). The Class row was never deleted -- it becomes
    // effective again automatically, with no re-write needed.
    const afterSchoolReEnabled = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        CLASS: classEnabled,
      },
    });
    expect(afterSchoolReEnabled.effectiveAvailability).toBe("EFFECTIVE_AVAILABLE");
    expect(afterSchoolReEnabled.sourceScope).toBe("CLASS");
    expect(afterSchoolReEnabled.sourcePolicyId).toBe("class-1");
  });

  it("two scopes independently agreeing on restriction: the more specific (lower) scope's own reason is reported as source, since it is not being overruled", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "DISABLED", reasonCategory: "SCHOOL_POLICY" }),
        CLASS: policy({ id: "class-1", scope: "CLASS", state: "DISABLED", reasonCategory: "TEACHER_DECISION" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.sourceScope).toBe("CLASS");
    expect(result.reasonCategory).toBe("TEACHER_DECISION");
  });

  it("DISABLED_AND_WAIVED resolves to effectiveRequirement=waived, waiverState=true, never fabricates mastery", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ile-1",
      pedagogicalRole: "CORE_LEARNING_ACTIVITY",
      policiesByScope: {
        STUDENT: policy({ id: "student-1", scope: "STUDENT", state: "DISABLED_AND_WAIVED", reasonCategory: "ACCESSIBILITY" }),
      },
    });
    expect(result.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(result.effectiveRequirement).toBe("waived");
    expect(result.waiverState).toBe(true);
    expect(result.reasonCategory).toBe("ACCESSIBILITY");
  });

  it("DISABLED_WITH_ALTERNATIVE resolves to effectiveRequirement=alternative and surfaces the alternative content ref", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ile-1",
      policiesByScope: {
        STUDENT: policy({
          id: "student-1",
          scope: "STUDENT",
          state: "DISABLED_WITH_ALTERNATIVE",
          alternativeContentRef: "ile-alt-1",
          reasonCategory: "ACCESSIBILITY",
        }),
      },
    });
    expect(result.effectiveRequirement).toBe("alternative");
    expect(result.alternativeContentRef).toBe("ile-alt-1");
  });

  it("plain DISABLED on OPTIONAL_ENRICHMENT content simply removes it (effectiveRequirement=waived, never required)", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT_ELEMENT",
      resourceRef: "infographic-1",
      pedagogicalRole: "OPTIONAL_ENRICHMENT",
      policiesByScope: { SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "DISABLED" }) },
    });
    expect(result.effectiveRequirement).toBe("waived");
  });

  it("plain DISABLED on CORE_LEARNING_ACTIVITY content stays required -- surfaces the gap rather than fabricating a waiver", () => {
    const result = resolveEffectiveAvailability({
      resourceType: "UNIT_ELEMENT",
      resourceRef: "core-exercise-1",
      pedagogicalRole: "CORE_LEARNING_ACTIVITY",
      policiesByScope: { SCHOOL: policy({ id: "school-1", scope: "SCHOOL", state: "DISABLED" }) },
    });
    expect(result.effectiveRequirement).toBe("required");
  });

  it("is order-independent: passing the same four policies in any object key order yields the same result", () => {
    const a = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        STUDENT: policy({ id: "s", scope: "STUDENT", state: "ENABLED" }),
        CLASS: policy({ id: "c", scope: "CLASS", state: "DISABLED" }),
        SCHOOL: policy({ id: "sc", scope: "SCHOOL", state: "ENABLED" }),
      },
    });
    const b = resolveEffectiveAvailability({
      resourceType: "UNIT",
      resourceRef: "u1",
      policiesByScope: {
        SCHOOL: policy({ id: "sc", scope: "SCHOOL", state: "ENABLED" }),
        STUDENT: policy({ id: "s", scope: "STUDENT", state: "ENABLED" }),
        CLASS: policy({ id: "c", scope: "CLASS", state: "DISABLED" }),
      },
    });
    expect(a).toEqual(b);
  });
});
