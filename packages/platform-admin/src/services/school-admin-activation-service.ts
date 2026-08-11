import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, TenantRepository } from "@quest-city-web/identity";
import {
  StaffAccountRepository,
  StaffTenantMembershipRepository,
  hashPassword,
  type StaffAccount,
} from "@quest-city-web/staff-identity";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

export interface SchoolAdminActivationResult {
  staffAccountId: string;
  email: string;
  /** Only present when a brand-new staff_account was created; never present on identity reuse or reactivation. Returned exactly once, never logged or audited. */
  temporaryPassword: string | undefined;
  identityReused: boolean;
  reactivated: boolean;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Never printed or logged -- only ever returned once in the API response body, mirroring tools/seed-staff.ts's --out-file discipline. */
function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * `POST /platform/tenants/{tenantId}/school-admins` (02_38 §21
 * indicative endpoint; this tranche's §11). Preserves ONE HUMAN -> ONE
 * PLATFORM IDENTITY (02_38 §9): if a `staff_account` with this email
 * already exists, it is reused, never duplicated. Does not implement
 * the normal teacher invitation flow (deferred to a later tranche, per
 * this tranche's exclusions) -- for a genuinely new identity, a
 * one-time temporary password is generated and returned once in the
 * response, the same disclosed pattern already used by
 * `tools/seed-staff.ts` for the equivalent offline case.
 */
export class SchoolAdminActivationService {
  private readonly tenants: TenantRepository;
  private readonly accounts: StaffAccountRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.accounts = new StaffAccountRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async activate(
    identity: PlatformAdminIdentity,
    input: { tenantId: string; email: string },
  ): Promise<SchoolAdminActivationResult> {
    assertCapability(identity, "school_admin.activate");

    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) {
      throw new PlatformAdminError("TENANT_NOT_FOUND");
    }
    if (tenant.status !== "ACTIVE") {
      throw new PlatformAdminError("TENANT_SUSPENDED", "Cannot activate a School Admin on a non-active tenant.");
    }

    const email = normalizeEmail(input.email);
    if (email.length === 0 || !email.includes("@")) {
      throw new PlatformAdminError("VALIDATION_ERROR", "email must be a valid address.");
    }

    let account: StaffAccount | null = await this.accounts.findByEmail(email);
    let temporaryPassword: string | undefined;
    const identityReused = account !== null;

    if (account && account.status !== "ACTIVE") {
      throw new PlatformAdminError("SCHOOL_ADMIN_IDENTITY_SUSPENDED", "The identity for this email is not ACTIVE.");
    }

    if (!account) {
      temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      account = await this.accounts.create({
        email,
        passwordHash,
        status: "ACTIVE",
        createdByActorType: "PLATFORM_ADMIN",
        createdByActorId: identity.staffAccountId,
      });
    }

    const existingMembership = await this.memberships.findByStaffAccountAndTenant(account.id, tenant.id);
    let reactivated = false;

    if (existingMembership) {
      if (existingMembership.role !== "SCHOOL_ADMIN") {
        throw new PlatformAdminError(
          "VALIDATION_ERROR",
          "This identity already holds a TEACHER membership on this tenant; role change is out of scope for this tranche.",
        );
      }
      if (existingMembership.status === "ACTIVE") {
        throw new PlatformAdminError("SCHOOL_ADMIN_ALREADY_ACTIVE");
      }
      // SUSPENDED SCHOOL_ADMIN membership on this tenant: reactivating is
      // the natural outcome of "activate" for this case, not a second
      // duplicate membership row (UNIQUE (staff_account_id, tenant_id)
      // would reject one anyway).
      await this.memberships.updateStatus(existingMembership.id, tenant.id, "ACTIVE");
      reactivated = true;
    } else {
      await this.memberships.create({ staffAccountId: account.id, tenantId: tenant.id, role: "SCHOOL_ADMIN", status: "ACTIVE" });
    }

    await this.audit.record({
      tenantId: tenant.id,
      actorType: "PLATFORM_ADMIN",
      actorId: identity.staffAccountId,
      action: "school_admin.activated",
      targetType: "staff_account",
      targetId: account.id,
      result: "SUCCESS",
      metadataRedacted: { identityReused, reactivated },
    });

    return { staffAccountId: account.id, email: account.email, temporaryPassword, identityReused, reactivated };
  }
}
