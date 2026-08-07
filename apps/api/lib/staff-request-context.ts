import { StaffIdentityError, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import type { ApiEnv } from "./env";
import { getStaffAuthService } from "./staff-identity-context";
import { readStaffSessionToken } from "./staff-session-cookie";

/** Every protected staff route resolves its identity through this single helper — no route re-implements session lookup. */
export async function requireStaffIdentity(request: Request, env: ApiEnv): Promise<StaffInternalIdentity> {
  const sessionToken = readStaffSessionToken(request, env);
  if (!sessionToken) {
    throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
  }
  return getStaffAuthService().resolveInternalIdentity(sessionToken);
}
