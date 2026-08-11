import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, TenantRepository, type Tenant } from "@quest-city-web/identity";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

export interface TenantProvisioningResult {
  tenant: Tenant;
}

/**
 * `POST /platform/tenants` (02_38 §21 indicative endpoint, this
 * tranche's own §12/§9). Creates only the tenant row itself -- no
 * classes, students, or demo content are ever auto-created (§9: "NON
 * creare automaticamente classi/studenti/demo content").
 */
export class TenantProvisioningService {
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async createSchoolTenant(identity: PlatformAdminIdentity, input: { name: string }): Promise<TenantProvisioningResult> {
    assertCapability(identity, "tenant.create");

    const name = input.name.trim();
    if (name.length === 0 || name.length > 200) {
      throw new PlatformAdminError("VALIDATION_ERROR", "name must be 1-200 characters.");
    }

    const publicId = `sch_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const tenant = await this.tenants.create({ publicId, type: "SCHOOL", status: "ACTIVE", name });

    await this.audit.record({
      tenantId: tenant.id,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "tenant.created",
      targetType: "tenant",
      targetId: tenant.id,
      result: "SUCCESS",
      metadataRedacted: { publicId: tenant.publicId, type: tenant.type },
    });

    return { tenant };
  }

  async listTenants(identity: PlatformAdminIdentity, input: { limit: number; offset: number }): Promise<Tenant[]> {
    assertCapability(identity, "tenant.read");
    return this.tenants.list(input);
  }
}
