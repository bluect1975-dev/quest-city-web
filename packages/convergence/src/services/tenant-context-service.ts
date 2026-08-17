import type { Pool } from "pg";
import { AuditRepository, TenantRepository, generateToken, hashToken } from "@quest-city-web/identity";
import { StaffIdentityError, StaffSessionRepository, StaffTenantMembershipRepository, type StaffInternalIdentity } from "@quest-city-web/staff-identity";

const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;

export interface TenantMembershipSummary {
  /** Distinguishes which of possibly several rows for the same tenantId this is (same-tenant multi-role, 02_25 v1.12 §6.16.6). */
  staffTenantMembershipId: string;
  tenantId: string;
  tenantType: "SCHOOL" | "INDEPENDENT_EDUCATOR";
  tenantName: string;
  role: "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR" | "ASACOM" | "SUPPORT_TEACHER";
  membershipStatus: "ACTIVE";
}

export interface SwitchSessionTenantResult {
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
  tenantId: string;
  role: "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR" | "ASACOM" | "SUPPORT_TEACHER";
}

/**
 * Tranche D context switching (02_35 v1.5 §11quater.5, 02_26 v1.14
 * §36.9-36.10) -- chooses NOT to extend `StaffAuthService.refresh()`
 * (which always preserves the SAME tenant/membership) and instead
 * implements its own rotation with a different (new) tenant/membership
 * pair, following that method's exact transaction/rotation shape
 * (BEGIN -> create new session -> revoke old -> COMMIT).
 */
export class TenantContextService {
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async listMyMemberships(identity: StaffInternalIdentity): Promise<TenantMembershipSummary[]> {
    const rows = await this.memberships.findByStaffAccount(identity.staffAccountId);
    const active = rows.filter((row) => row.status === "ACTIVE");
    const summaries: TenantMembershipSummary[] = [];
    for (const row of active) {
      const tenant = await this.tenants.findById(row.tenantId);
      if (!tenant) continue;
      summaries.push({
        // Additive field (02_25 v1.12 §6.16.6, 02_26 v1.16 §37bis): the
        // pre-existing response shape had no per-row identifier, which was
        // harmless while at most one row could ever share a tenantId. With
        // same-tenant multi-role now possible, the client needs a stable
        // id to pass as switch-tenant's own staffTenantMembershipId
        // parameter -- (tenantId, role) is technically also unique per
        // account, but the switch-tenant contract explicitly names
        // staffTenantMembershipId, so this list must expose it. No
        // existing field renamed or removed.
        staffTenantMembershipId: row.id,
        tenantId: row.tenantId,
        tenantType: tenant.type,
        tenantName: tenant.name,
        role: row.role,
        membershipStatus: "ACTIVE",
      });
    }
    return summaries;
  }

  /**
   * `tenantId` is resolved and verified exclusively server-side against
   * the caller's own ACTIVE memberships -- never trusted as-is from the
   * client (same principle as tenant.type resolution, AGENTS.md §4.22
   * rule 3). A tenant without an ACTIVE membership produces
   * STAFF_FORBIDDEN, never a session created on an unauthorized tenant.
   *
   * Deliberately does NOT set `rotatedFrom` on the created row (unlike
   * `StaffAuthService.refresh()`): `staff_session_rotated_from_tenant_id_fkey`
   * is a composite FK on (rotated_from, tenant_id), scoped to same-tenant
   * rotation -- the predecessor session here is on a DIFFERENT tenant, so
   * setting it would violate that constraint. The old->new transition is
   * still fully recorded via the explicit `tenant_context.switched` audit
   * event below (fromTenantId/toTenantId), so no lineage information is lost.
   */
  /**
   * `staffTenantMembershipId` (02_25 v1.12 §6.16.6, 02_26 v1.16 §37bis):
   * required when the identity holds more than one ACTIVE membership on
   * `tenantId` (same-tenant multi-role); optional (auto-resolved) when
   * only one exists, preserving the pre-existing call shape for every
   * caller that predates multi-role. `tenantId` alone matching more than
   * one row is never resolved heuristically -- 409
   * AMBIGUOUS_TENANT_MEMBERSHIP instead.
   */
  async switchTenant(
    identity: StaffInternalIdentity,
    tenantId: string,
    staffTenantMembershipId?: string,
  ): Promise<SwitchSessionTenantResult> {
    let targetMembership;
    if (staffTenantMembershipId) {
      const candidate = await this.memberships.findById(staffTenantMembershipId, tenantId);
      // The referenced membership must both exist under this tenantId AND
      // actually belong to the calling identity -- never trust a
      // client-supplied id/tenant pair without an ownership check.
      targetMembership = candidate && candidate.staffAccountId === identity.staffAccountId ? candidate : null;
    } else {
      const candidates = await this.memberships.findAllByStaffAccountAndTenant(identity.staffAccountId, tenantId);
      const activeCandidates = candidates.filter((m) => m.status === "ACTIVE");
      if (activeCandidates.length > 1) {
        throw new StaffIdentityError(
          "AMBIGUOUS_TENANT_MEMBERSHIP",
          "staffTenantMembershipId è obbligatorio: più membership attive su questo tenant.",
        );
      }
      targetMembership = activeCandidates[0] ?? null;
    }
    if (!targetMembership || targetMembership.status !== "ACTIVE") {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "No ACTIVE membership on the requested tenant.");
    }

    const newSessionToken = generateToken(SESSION_TOKEN_BYTES);
    const newCsrfToken = generateToken(CSRF_TOKEN_BYTES);
    const absoluteExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessions = new StaffSessionRepository(client);
      const created = await sessions.create({
        staffAccountId: identity.staffAccountId,
        tenantId: targetMembership.tenantId,
        staffTenantMembershipId: targetMembership.id,
        tokenHash: hashToken(newSessionToken),
        csrfTokenHash: hashToken(newCsrfToken),
        absoluteExpiresAt,
      });
      await sessions.revoke(identity.sessionId, identity.tenantId, "ROTATED");
      await client.query("COMMIT");

      await this.audit.record({
        tenantId: targetMembership.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "tenant_context.switched",
        targetType: "staff_session",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: {
          fromTenantId: identity.tenantId,
          toTenantId: targetMembership.tenantId,
          toStaffTenantMembershipId: targetMembership.id,
        },
      });

      return {
        sessionToken: newSessionToken,
        csrfToken: newCsrfToken,
        absoluteExpiresAt,
        tenantId: targetMembership.tenantId,
        role: targetMembership.role,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
