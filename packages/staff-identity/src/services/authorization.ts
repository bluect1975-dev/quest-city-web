import { StaffIdentityError } from "../errors";
import type { StaffInternalIdentity } from "./staff-auth-service";

/**
 * TEACHER is scoped to explicitly assigned classes only; SCHOOL_ADMIN is
 * scoped to its entire tenant, implicitly (02_35 §3.2). Every staff-scoped
 * read/write on a specific class must call this before touching data —
 * CLASS_ACCESS_DENIED is a uniform response for "does not exist" and "not
 * in scope", anti-enumeration (02_35 §5, §13).
 */
export function assertClassInScope(identity: StaffInternalIdentity, classId: string): void {
  if (!isClassInScope(identity, classId)) {
    throw new StaffIdentityError("CLASS_ACCESS_DENIED");
  }
}

/** Boolean form for call sites that map an out-of-scope class to a different uniform error (e.g. REVIEW_ITEM_NOT_FOUND, 02_35 §13). */
export function isClassInScope(identity: StaffInternalIdentity, classId: string): boolean {
  if (identity.role === "SCHOOL_ADMIN") {
    return true;
  }
  return Boolean(identity.classScope && identity.classScope.includes(classId));
}
