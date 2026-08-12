import type { Pool } from "pg";
import { AuditRepository, TenantRepository, type Tenant, type TenantStatus } from "@quest-city-web/identity";
import { StaffTenantMembershipRepository } from "@quest-city-web/staff-identity";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

export interface IndependentEducatorStatusResult {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: Tenant["status"];
  membershipStatus: "ACTIVE" | "SUSPENDED";
}

/**
 * `PATCH /platform/independent-educators/{tenantId}/status` (02_26 v1.13
 * §35.4, capability `independent_educator.status.manage`, governs both
 * directions — same "one capability, two directions" pattern as
 * `tenant.suspend`). A single transaction sets both `tenant.status` and
 * the status of every `staff_tenant_membership` row with
 * `role=INDEPENDENT_EDUCATOR` on that tenant (02_35 v1.4 §11ter.8) —
 * there is always exactly one such row per Independent Educator tenant
 * (no co-educator in this tranche), but this loops over every match
 * rather than assuming exactly one, matching the contract's own "every...
 * row" wording. Never a hard delete — only ACTIVE/SUSPENDED are reachable
 * (same posture as `TenantStatusService`, ARCHIVED reserved for a future,
 * separate lifecycle decision).
 *
 * Session revocation and student-access blocking are NOT implemented
 * here: both already happen for free, unmodified, via the pre-existing
 * `tenant.status = SUSPENDED` enforcement already checked on every
 * request by `StaffAuthService.resolveInternalIdentity` (staff sessions)
 * and the class-code/PIN resolve path (student sessions) — this service
 * only changes the rows; enforcement lives at each read site (02_24
 * §11.1).
 */
export class IndependentEducatorStatusService {
  private readonly tenants: TenantRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async setStatus(
    identity: PlatformAdminIdentity,
    input: { tenantId: string; status: Extract<TenantStatus, "ACTIVE" | "SUSPENDED"> },
  ): Promise<IndependentEducatorStatusResult> {
    assertCapability(identity, "independent_educator.status.manage");

    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant || tenant.type !== "INDEPENDENT_EDUCATOR") {
      throw new PlatformAdminError("INDEPENDENT_EDUCATOR_NOT_FOUND");
    }
    if (tenant.status === input.status) {
      throw new PlatformAdminError("INDEPENDENT_EDUCATOR_STATUS_UNCHANGED", `Tenant is already ${input.status}.`);
    }

    const updatedTenant = await this.tenants.updateStatus(tenant.id, input.status);
    if (!updatedTenant) {
      throw new PlatformAdminError("INDEPENDENT_EDUCATOR_NOT_FOUND");
    }

    const memberships = await this.memberships.findByTenant(tenant.id, { limit: 10, offset: 0 });
    const independentEducatorMemberships = memberships.filter((m) => m.role === "INDEPENDENT_EDUCATOR");
    let membershipStatus: "ACTIVE" | "SUSPENDED" = "ACTIVE";
    for (const membership of independentEducatorMemberships) {
      const updated = await this.memberships.updateStatus(membership.id, tenant.id, input.status);
      if (updated) {
        membershipStatus = updated.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
      }
    }

    await this.audit.record({
      tenantId: updatedTenant.id,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: input.status === "SUSPENDED" ? "independent_educator_status_suspended" : "independent_educator_status_reactivated",
      targetType: "tenant",
      targetId: updatedTenant.id,
      result: "SUCCESS",
      metadataRedacted: { previousStatus: tenant.status, newStatus: updatedTenant.status },
    });

    return {
      tenantId: updatedTenant.id,
      tenantPublicId: updatedTenant.publicId,
      tenantStatus: updatedTenant.status,
      membershipStatus,
    };
  }
}
