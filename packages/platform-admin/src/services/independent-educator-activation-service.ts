import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, TenantRepository, type Tenant } from "@quest-city-web/identity";
import {
  StaffAccountRepository,
  StaffTenantMembershipRepository,
  hashPassword,
  type StaffAccount,
} from "@quest-city-web/staff-identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

const PLATFORM_INDEPENDENT_EDUCATOR_ACTIVATE_SCOPE = "platform_independent_educator_activate";

export interface IndependentEducatorSummary {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: Tenant["status"];
  tenantName: string;
  staffAccountId: string;
  email: string;
  membershipStatus: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface IndependentEducatorActivationResult {
  tenantId: string;
  tenantPublicId: string;
  staffAccountId: string;
  email: string;
  /** Present only when a brand-new staff_account was created; never present on identity reuse. Returned exactly once, never logged or audited (same discipline as SchoolAdminActivationService). */
  temporaryPassword: string | undefined;
  identityReused: boolean;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Never printed or logged — only ever returned once in the API response body (same pattern as school-admin-activation-service.ts). */
function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

function activateRequestHash(payload: { email: string; tenantName: string }): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * `POST /platform/independent-educators` (02_26 v1.13 §35.2,
 * contracts/quest-city-platform-openapi-v1_11.yaml
 * `activateIndependentEducator`). One transaction: identity resolution
 * (reuse an existing `staff_account` by email or create a new one — ONE
 * HUMAN -> ONE PLATFORM IDENTITY, 02_38 v1.3 §9), tenant provisioning
 * (`type=INDEPENDENT_EDUCATOR`, no classes/students/demo content
 * auto-created, same principle as `TenantProvisioningService`), membership
 * creation (`role=INDEPENDENT_EDUCATOR`, `status=ACTIVE`), controlled
 * credential bootstrap, audit. An identity that already holds an ACTIVE
 * SCHOOL membership is explicitly allowed to also become an Independent
 * Educator (02_38 v1.3 §13, 02_35 v1.4 §11ter.6) — this creates a second,
 * independent `staff_tenant_membership` row on a new tenant, never a
 * second `staff_account`.
 *
 * Idempotency (02_26 v1.13 §35.9): `Idempotency-Key` required, scope
 * `platform_independent_educator_activate`, `tenantId: null` — same
 * architecture as `platform_tenant_create` (no tenant exists yet at
 * request time), `scopeKey` partitioned by the acting Platform Admin's
 * `staffAccountId`. Reuses `IdempotencyRecordRepository` exactly as every
 * other scope; no second idempotency mechanism.
 */
export class IndependentEducatorActivationService {
  private readonly tenants: TenantRepository;
  private readonly accounts: StaffAccountRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRecordRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.accounts = new StaffAccountRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.audit = new AuditRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
  }

  async activate(
    identity: PlatformAdminIdentity,
    input: { email: string; tenantName: string; idempotencyKey: string },
  ): Promise<IndependentEducatorActivationResult> {
    assertCapability(identity, "independent_educator.activate");

    const email = normalizeEmail(input.email);
    if (email.length === 0 || !email.includes("@")) {
      throw new PlatformAdminError("VALIDATION_ERROR", "email must be a valid address.");
    }
    const tenantName = input.tenantName.trim();
    if (tenantName.length === 0 || tenantName.length > 200) {
      throw new PlatformAdminError("VALIDATION_ERROR", "tenantName must be 1-200 characters.");
    }

    const scopeKey = `${identity.staffAccountId}:${input.idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: null,
      scope: PLATFORM_INDEPENDENT_EDUCATOR_ACTIVATE_SCOPE,
      scopeKey,
      requestHash: activateRequestHash({ email, tenantName }),
    });

    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as IndependentEducatorActivationResult;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new PlatformAdminError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riusata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new PlatformAdminError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new PlatformAdminError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      let account: StaffAccount | null = await this.accounts.findByEmail(email);
      let temporaryPassword: string | undefined;
      const identityReused = account !== null;

      if (account && account.status !== "ACTIVE") {
        throw new PlatformAdminError("INDEPENDENT_EDUCATOR_IDENTITY_SUSPENDED", "The identity for this email is not ACTIVE.");
      }

      if (account) {
        // ONE HUMAN -> ONE PLATFORM IDENTITY (02_38 v1.3 §9): an existing
        // identity already holding an ACTIVE membership anywhere with
        // role=INDEPENDENT_EDUCATOR cannot be activated a second time —
        // it would either duplicate the tenant or silently reuse an
        // unrelated one. Mixed-identity (an existing ACTIVE SCHOOL
        // membership) is explicitly NOT this case (02_38 v1.3 §13,
        // 02_35 v1.4 §11ter.6) — findByStaffAccount only rejects when an
        // ACTIVE INDEPENDENT_EDUCATOR membership is found.
        const existingMemberships = await this.memberships.findByStaffAccount(account.id);
        const activeIndependentEducatorMembership = existingMemberships.find(
          (m) => m.role === "INDEPENDENT_EDUCATOR" && m.status === "ACTIVE",
        );
        if (activeIndependentEducatorMembership) {
          throw new PlatformAdminError("INDEPENDENT_EDUCATOR_ALREADY_ACTIVE");
        }
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

      const publicId = `ie_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const tenant = await this.tenants.create({
        publicId,
        type: "INDEPENDENT_EDUCATOR",
        status: "ACTIVE",
        name: tenantName,
      });

      const membership = await this.memberships.create({
        staffAccountId: account.id,
        tenantId: tenant.id,
        role: "INDEPENDENT_EDUCATOR",
        status: "ACTIVE",
      });

      const result: IndependentEducatorActivationResult = {
        tenantId: tenant.id,
        tenantPublicId: tenant.publicId,
        staffAccountId: account.id,
        email: account.email,
        temporaryPassword,
        identityReused,
      };

      await this.idempotency.complete({
        tenantId: null,
        scope: PLATFORM_INDEPENDENT_EDUCATOR_ACTIVATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });

      await this.audit.record({
        tenantId: tenant.id,
        actorType: "PLATFORM_ADMIN",
        actorId: identity.staffAccountId,
        action: "independent_educator_tenant_provisioned",
        targetType: "tenant",
        targetId: tenant.id,
        result: "SUCCESS",
        metadataRedacted: { publicId: tenant.publicId },
      });

      await this.audit.record({
        tenantId: tenant.id,
        actorType: "PLATFORM_ADMIN",
        actorId: identity.staffAccountId,
        action: "independent_educator_activated",
        targetType: "staff_tenant_membership",
        targetId: membership.id,
        result: "SUCCESS",
        metadataRedacted: { identityReused },
      });

      return result;
    } catch (error) {
      if (error instanceof PlatformAdminError && error.code === "INDEPENDENT_EDUCATOR_ALREADY_ACTIVE") {
        await this.audit.record({
          tenantId: null,
          actorType: "PLATFORM_ADMIN",
          actorId: identity.staffAccountId,
          action: "independent_educator_activation_rejected",
          targetType: "staff_account",
          targetId: null,
          result: "FAILURE",
          metadataRedacted: { reason: error.code },
        });
      }
      await this.idempotency.fail({
        tenantId: null,
        scope: PLATFORM_INDEPENDENT_EDUCATOR_ACTIVATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async summarize(tenant: Tenant): Promise<IndependentEducatorSummary | null> {
    const memberships = await this.memberships.findByTenant(tenant.id, { limit: 1, offset: 0 });
    const membership = memberships.find((m) => m.role === "INDEPENDENT_EDUCATOR");
    if (!membership) {
      return null;
    }
    const account = await this.accounts.findById(membership.staffAccountId);
    if (!account) {
      return null;
    }
    return {
      tenantId: tenant.id,
      tenantPublicId: tenant.publicId,
      tenantStatus: tenant.status,
      tenantName: tenant.name,
      staffAccountId: account.id,
      email: account.email,
      membershipStatus: membership.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  /** `GET /platform/independent-educators` (02_26 v1.13 §35.3, capability `independent_educator.read`) — paginated, no didactic data. */
  async list(identity: PlatformAdminIdentity, input: { limit: number; offset: number }): Promise<IndependentEducatorSummary[]> {
    assertCapability(identity, "independent_educator.read");
    const tenants = await this.tenants.list(input);
    const independentEducatorTenants = tenants.filter((t) => t.type === "INDEPENDENT_EDUCATOR");
    const summaries = await Promise.all(independentEducatorTenants.map((t) => this.summarize(t)));
    return summaries.filter((s): s is IndependentEducatorSummary => s !== null);
  }

  /** `GET /platform/independent-educators/{tenantId}` (02_26 v1.13 §35.3, capability `independent_educator.read`). */
  async getById(identity: PlatformAdminIdentity, tenantId: string): Promise<IndependentEducatorSummary> {
    assertCapability(identity, "independent_educator.read");
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.type !== "INDEPENDENT_EDUCATOR") {
      throw new PlatformAdminError("INDEPENDENT_EDUCATOR_NOT_FOUND");
    }
    const summary = await this.summarize(tenant);
    if (!summary) {
      throw new PlatformAdminError("INDEPENDENT_EDUCATOR_NOT_FOUND");
    }
    return summary;
  }
}
