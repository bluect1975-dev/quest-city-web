import type { Pool } from "pg";
import { AuditRepository, TenantRepository, type Tenant, type TenantStatus } from "@quest-city-web/identity";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

/**
 * `PATCH /platform/tenants/{id}/status` (02_38 §21 indicative endpoint;
 * this tranche's §10). Only ACTIVE and SUSPENDED are reachable through
 * this service -- ARCHIVED exists in the `tenant.status` CHECK
 * (migration 0002) but is not a transition this tranche exposes
 * (irreversible archival is out of scope; §10: "NON hard-delete
 * tenant" -- ARCHIVED is reserved for a future, separate, more
 * deliberate lifecycle decision). Suspension is enforced for real by
 * every reader of `tenant.status` at request time (staff auth, student
 * class-code resolve) -- this service only changes the row; enforcement
 * lives at each read site, per 02_24 §11.1 ("le query web devono
 * applicare tenant scope server-side").
 */
export class TenantStatusService {
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async setStatus(
    identity: PlatformAdminIdentity,
    input: { tenantId: string; status: Extract<TenantStatus, "ACTIVE" | "SUSPENDED"> },
  ): Promise<Tenant> {
    assertCapability(identity, "tenant.suspend");

    const current = await this.tenants.findById(input.tenantId);
    if (!current) {
      throw new PlatformAdminError("TENANT_NOT_FOUND");
    }
    if (current.status === input.status) {
      throw new PlatformAdminError("TENANT_STATUS_UNCHANGED", `Tenant is already ${input.status}.`);
    }

    const updated = await this.tenants.updateStatus(input.tenantId, input.status);
    if (!updated) {
      throw new PlatformAdminError("TENANT_NOT_FOUND");
    }

    await this.audit.record({
      tenantId: updated.id,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: input.status === "SUSPENDED" ? "tenant.suspended" : "tenant.reactivated",
      targetType: "tenant",
      targetId: updated.id,
      result: "SUCCESS",
      metadataRedacted: { previousStatus: current.status, newStatus: updated.status },
    });

    return updated;
  }
}
