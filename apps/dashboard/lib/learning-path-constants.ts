import type { LearningPathReasonCategory, LearningPathResourceType, LearningPathState } from "./staff-api-types";

/** Granular Learning Path Control (02_41 v1.1) -- shared enum value lists for the three GLPC dashboard pages. */
export const RESOURCE_TYPE_VALUES: readonly LearningPathResourceType[] = ["SUBJECT", "TRACK", "YEAR", "MODULE", "UNIT", "UNIT_ELEMENT"];

export const REASON_CATEGORY_VALUES: readonly LearningPathReasonCategory[] = [
  "PEDAGOGICAL",
  "ACCESSIBILITY",
  "TEMPORARY_SUPPORT",
  "ALTERNATIVE_ACTIVITY",
  "CURRICULUM_SCHEDULING",
  "SCHOOL_POLICY",
  "TEACHER_DECISION",
  "OTHER_STRUCTURED",
];

/** SCHOOL/CLASS scope states -- UNAVAILABLE_FOR_USE is PLATFORM-only (02_41 §15, migration 0013 CHECK constraint), never offered here. */
export const SCHOOL_STATE_VALUES: readonly LearningPathState[] = ["ENABLED", "DISABLED", "DISABLED_AND_WAIVED", "DISABLED_WITH_ALTERNATIVE"];

/** STUDENT scope states -- same set as SCHOOL/CLASS (waiver/alternative are the two disable-mode variants meaningful at any of these three scopes). */
export const STUDENT_STATE_VALUES: readonly LearningPathState[] = ["ENABLED", "DISABLED", "DISABLED_AND_WAIVED", "DISABLED_WITH_ALTERNATIVE"];
