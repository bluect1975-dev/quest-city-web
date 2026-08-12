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
]);

export function hasStaffCapability(identity: StaffInternalIdentity, capability: StaffCapability): boolean {
  if (identity.role === "SCHOOL_ADMIN") {
    return true;
  }
  if (identity.role === "INDEPENDENT_EDUCATOR") {
    return INDEPENDENT_EDUCATOR_CAPABILITIES.has(capability);
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
