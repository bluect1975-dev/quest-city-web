import { StaffIdentityError } from "../errors";
import type { StaffInternalIdentity } from "./staff-auth-service";

/**
 * The 9 named capabilities introduced by School Onboarding + Staff
 * Membership (02_35 v1.2 §11bis.10, 02_26 v1.11 §33.8,
 * contracts/quest-city-platform-openapi-v1_9.yaml `StaffCapability`).
 * "Illustrativo-additivo, non chiuso" — a role-static mapping is
 * deliberately used here rather than a new per-membership grant table:
 * nothing in the canonical contract describes capabilities as
 * individually grantable per staff member (unlike Platform Admin's
 * `platform_admin_grant`, which explicitly is flexible/per-admin) — every
 * capability in this list is determined entirely by `role`
 * (SCHOOL_ADMIN vs TEACHER), so a new grant table would be unrequested
 * machinery. `roster.manage` and `assignment.create` are additionally
 * scoped to `classScope` for TEACHER — callers must still call
 * `assertClassInScope`/`isClassInScope` for the specific class in
 * question; this module only decides role-level capability possession.
 */
export const STAFF_CAPABILITIES = [
  "staff.invite",
  "staff.member.read",
  "staff.membership.suspend",
  "staff.membership.revoke",
  "class.create",
  "class.manage",
  "class.teacher.assign",
  "roster.manage",
  "assignment.create",
  // School Pilot Readiness Tranche D (02_38 v1.4 §10.6, 02_35 v1.5
  // §11quater.2-3): the four staff-role-derived convergence capabilities.
  // convergence.preview/.execute/.rollback.review are deliberately NOT
  // here -- those are PLATFORM_ADMIN-only, governed by capability_grant
  // (@quest-city-web/platform-admin), never by role.
  "convergence.request",
  "convergence.read",
  "convergence.approve.teacher",
  "convergence.approve.school",
  "ownership.transfer.approve",
  // Student Support Roles (02_39 v1.2 §24, 02_35 v1.7 §11quinquies.5/
  // §11sexies.5, migration 0012). SCHOOL_ADMIN-only, shared by both new
  // roles (never granted to ASACOM/SUPPORT_TEACHER themselves --
  // §11quinquies.6/§11sexies.6, no self-assignment).
  "student_support_assignment.manage",
  // ASACOM-only (8 capabilities, 02_39 §24, invariant since v1.0).
  "asacom.read.assigned_students",
  "asacom.support.record",
  "asacom.observation.record",
  "asacom.facilitation.read",
  "asacom.facilitation.apply",
  "asacom.facilitation.propose",
  "asacom.difficulty.propose",
  "asacom.progress.read.assigned",
  // SUPPORT_TEACHER-only (6 capabilities, 02_39 §24 v1.1). Class scope
  // (roster/curriculum/review queue) needs NO new capability here --
  // it reuses TEACHER's existing implicit staff_class_assignment
  // authorization untouched (§11sexies.5).
  "support_teacher.support.record",
  "support_teacher.observation.record",
  "support_teacher.facilitation.read",
  "support_teacher.facilitation.apply",
  "support_teacher.difficulty.apply",
  "support_teacher.progress.read.assigned",
] as const;

export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/** Held by TEACHER (classScope-limited) in addition to SCHOOL_ADMIN (tenant-wide); every other capability is SCHOOL_ADMIN-only. */
const TEACHER_CAPABILITIES: ReadonlySet<StaffCapability> = new Set(["roster.manage", "assignment.create"]);

/**
 * INDEPENDENT_EDUCATOR (02_35 v1.4 §11ter.5): tenant-wide reuse of
 * class.create/class.manage/roster.manage/assignment.create, the same
 * four capabilities SCHOOL_ADMIN already holds — but never
 * staff.invite/staff.member.read/staff.membership.suspend/
 * staff.membership.revoke/class.teacher.assign (§11ter.9: no co-educator
 * invitation in this tranche). Deliberately not "all" (unlike
 * SCHOOL_ADMIN): an explicit set, so a future capability added to
 * SCHOOL_ADMIN does not silently leak to INDEPENDENT_EDUCATOR.
 */
const INDEPENDENT_EDUCATOR_CAPABILITIES: ReadonlySet<StaffCapability> = new Set([
  "class.create",
  "class.manage",
  "roster.manage",
  "assignment.create",
  // Tranche D (02_35 v1.5 §11quater.3): as the source-tenant party, an
  // INDEPENDENT_EDUCATOR may request a convergence, read their own
  // requests, and confirm the teacher side of an approval. Never
  // convergence.approve.school or ownership.transfer.approve (those are
  // SCHOOL_ADMIN-only, the target-tenant party) and never
  // convergence.preview/.execute/.rollback.review (PLATFORM_ADMIN-only).
  "convergence.request",
  "convergence.read",
  "convergence.approve.teacher",
]);

/**
 * ASACOM (02_39 §24, invariant v1.0): eight capabilities, none tenant-wide
 * -- every one of them is further narrowed to the caller's own ACTIVE
 * `support_student_assignment` rows at the service layer
 * (`@quest-city-web/student-support`), not here. `asacom.facilitation.apply`
 * covers SESSION_ONLY only (§7.1) -- the PROFILE_LEVEL/SESSION_ONLY
 * distinction is enforced by the facilitation service, not by a second
 * capability.
 */
const ASACOM_CAPABILITIES: ReadonlySet<StaffCapability> = new Set([
  "asacom.read.assigned_students",
  "asacom.support.record",
  "asacom.observation.record",
  "asacom.facilitation.read",
  "asacom.facilitation.apply",
  "asacom.facilitation.propose",
  "asacom.difficulty.propose",
  "asacom.progress.read.assigned",
]);

/**
 * SUPPORT_TEACHER (02_39 §24 v1.1): six capabilities, all narrowed to the
 * caller's own ACTIVE `support_student_assignment` rows at the service
 * layer. Class-level scope (roster/curriculum/review queue) is
 * deliberately NOT modeled as a capability here -- it reuses TEACHER's
 * existing implicit `staff_class_assignment` authorization untouched
 * (§11sexies.5), resolved via `isClassInScope`/`assertClassInScope`
 * exactly as for TEACHER.
 */
const SUPPORT_TEACHER_CAPABILITIES: ReadonlySet<StaffCapability> = new Set([
  "support_teacher.support.record",
  "support_teacher.observation.record",
  "support_teacher.facilitation.read",
  "support_teacher.facilitation.apply",
  "support_teacher.difficulty.apply",
  "support_teacher.progress.read.assigned",
]);

export function hasStaffCapability(identity: StaffInternalIdentity, capability: StaffCapability): boolean {
  if (identity.role === "SCHOOL_ADMIN") {
    return true;
  }
  if (identity.role === "INDEPENDENT_EDUCATOR") {
    return INDEPENDENT_EDUCATOR_CAPABILITIES.has(capability);
  }
  // ASACOM and SUPPORT_TEACHER each get an explicit branch, never the
  // TEACHER fallthrough below -- two disjoint professional mandates
  // (02_39 §1, §3), never "TEACHER minus/plus a few capabilities".
  if (identity.role === "ASACOM") {
    return ASACOM_CAPABILITIES.has(capability);
  }
  if (identity.role === "SUPPORT_TEACHER") {
    return SUPPORT_TEACHER_CAPABILITIES.has(capability);
  }
  return TEACHER_CAPABILITIES.has(capability);
}

export function assertStaffCapability(identity: StaffInternalIdentity, capability: StaffCapability): void {
  if (!hasStaffCapability(identity, capability)) {
    throw new StaffIdentityError("STAFF_FORBIDDEN", `Missing capability: ${capability}`, {
      safeDetails: { capability },
    });
  }
}
