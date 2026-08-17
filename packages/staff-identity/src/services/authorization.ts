import { StaffIdentityError } from "../errors";
import type { StaffInternalIdentity } from "./staff-auth-service";

/**
 * TEACHER and SUPPORT_TEACHER (02_39 v1.1 §3bis.2, 02_35 v1.7 §11sexies.4
 * -- identical mechanism, contitolarità di classe) are scoped to
 * explicitly assigned classes only; SCHOOL_ADMIN and INDEPENDENT_EDUCATOR
 * are each scoped to their entire tenant, implicitly (02_35 §3.2,
 * §11ter.4 — "nessuna riga staff_class_assignment è necessaria" for
 * INDEPENDENT_EDUCATOR, same pattern as SCHOOL_ADMIN). ASACOM has NO
 * implicit class scope at all (02_39 §4.3, §11quinquies.4) -- its
 * `classScope` is always null, so this always resolves false for ASACOM,
 * correctly. Every staff-scoped read/write on a specific class must call
 * this before touching data — CLASS_ACCESS_DENIED is a uniform response
 * for "does not exist" and "not in scope", anti-enumeration (02_35 §5,
 * §13).
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
