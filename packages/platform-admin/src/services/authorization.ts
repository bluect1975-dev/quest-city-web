import { PlatformAdminError } from "../errors";
import type { Capability } from "../repository/platform-admin-grant-repository";
import type { PlatformAdminIdentity } from "./platform-auth-service";

/**
 * Capability-first authorization (02_27 §5.3, 02_38 §4.1): role name
 * alone never gates a Platform Admin operation. Every route handler
 * calls this before performing its action -- `PlatformAdminIdentity`
 * already carries the actor's granted capability set, resolved once at
 * session-lookup time (`PlatformAuthService.resolveIdentity`).
 */
export function assertCapability(identity: PlatformAdminIdentity, capability: Capability): void {
  if (!identity.capabilities.includes(capability)) {
    throw new PlatformAdminError("CAPABILITY_DENIED", `Missing required capability: ${capability}`, {
      safeDetails: { capability },
    });
  }
}
