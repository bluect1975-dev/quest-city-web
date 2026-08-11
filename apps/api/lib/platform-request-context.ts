import { PlatformAdminError, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import type { ApiEnv } from "./env";
import { getPlatformAuthService } from "./platform-identity-context";
import { readPlatformSessionToken } from "./platform-session-cookie";

/** Every protected platform route resolves its identity through this single helper — no route re-implements session lookup. */
export async function requirePlatformAdminIdentity(request: Request, env: ApiEnv): Promise<PlatformAdminIdentity> {
  const sessionToken = readPlatformSessionToken(request, env);
  if (!sessionToken) {
    throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
  }
  return getPlatformAuthService().resolveIdentity(sessionToken);
}
