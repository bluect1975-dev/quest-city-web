import { StaffIdentityError } from "../errors";
import type { StaffInternalIdentity } from "./staff-auth-service";

/**
 * TEACHER is scoped to explicitly assigned classes only; SCHOOL_ADMIN and
 * INDEPENDENT_EDUCATOR are each scoped to their entire tenant, implicitly
 * (02_35 §3.2, §11ter.4 — "nessuna riga staff_class_assignment è
 * necessaria" for INDEPENDENT_EDUCATOR, same pattern as SCHOOL_ADMIN).
 * Every staff-scoped read/write on a specific class must call this before
 * touching data — CLASS_ACCESS_DENIED is a uniform response for "does not
 * exist" and "not in scope", anti-enumeration (02_35 §5, §13).
 */
export function assertClassInScope(identity: StaffInternalIdentity, classId: string): void {
  if (!isClassInScope(identity, classId)) {
    throw new StaffIdentityError("CLASS_ACCESS_DENIED");
  }
}

/** Boolean form for call sites that map an out-of-scope class to a different uniform error (e.g. REVIEW_ITEM_NOT_FOUND, 02_35 §13). */
export function isClassInScope(identity: StaffInternalIdentity, classId: string): boolean {
  if (identity.role === "SCHOOL_ADMIN" || identity.role === "INDEPENDENT_EDUCATOR") {
    return true;
  }
  return Boolean(identity.classScope && identity.classScope.includes(classId));
}
