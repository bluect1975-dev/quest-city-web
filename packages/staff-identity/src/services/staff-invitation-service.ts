import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, generateToken, hashToken, SESSION_TOKEN_BYTES } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { hashPassword } from "../crypto/password";
import { StaffAccountRepository } from "../repository/staff-account-repository";
import { StaffTenantMembershipRepository } from "../repository/staff-tenant-membership-repository";
import { StaffInvitationRepository } from "../repository/staff-invitation-repository";
import { assertStaffCapability } from "./capability";
import type { StaffInternalIdentity } from "./staff-auth-service";

const IDEMPOTENCY_SCOPE = "staff_invitation_create";
/** Fixed, non-configurable TTL (02_35 v1.2 §11bis.3): createdAt + 168 hours (7 days). */
const INVITATION_TTL_MS = 168 * 60 * 60 * 1000;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/** Never disclosed anywhere — replaced by a real password the moment acceptStaffInvitation runs (staff_account.requires_password_setup). */
function generatePlaceholderPassword(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateStaffInvitationResult {
  invitationId: string;
  staffTenantMembershipId: string;
  email: string;
  role: "TEACHER";
  status: "INVITED";
  expiresAt: string;
  /** Present exactly once, in this response only — never persisted in plaintext, never logged. */
  acceptanceToken: string;
  identityReused: boolean;
  createdAt: string;
}

export interface AcceptStaffInvitationResult {
  staffTenantMembershipId: string;
  status: "ACTIVE";
  email: string;
}

/**
 * `POST /staff/invitations` + `POST /staff/invitations/accept` (02_35 v1.2
 * §11bis.1-§11bis.3). SCHOOL_ADMIN-only issue, ONE HUMAN -> ONE PLATFORM
 * IDENTITY (02_38 §9, applied by analogy): reuses an existing
 * `staff_account` by email when present, never duplicates it. Only
 * `TEACHER` is invitable through this flow — a second SCHOOL_ADMIN
 * remains exclusively `PLATFORM_ADMIN`'s `activateSchoolAdmin`
 * responsibility (02_26 §32.5, untouched).
 */
export class StaffInvitationService {
  private readonly accounts: StaffAccountRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly invitations: StaffInvitationRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.accounts = new StaffAccountRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.invitations = new StaffInvitationRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async createInvitation(input: {
    identity: StaffInternalIdentity;
    email: string;
    idempotencyKey: string;
  }): Promise<CreateStaffInvitationResult> {
    const { identity } = input;
    assertStaffCapability(identity, "staff.invite");

    const email = normalizeEmail(input.email);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: requestHashOf({ email }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as CreateStaffInvitationResult;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      // ONE HUMAN -> ONE PLATFORM IDENTITY (02_38 §9): reuse by email, never duplicate.
      let account = await this.accounts.findByEmail(email);
      const identityReused = account !== null;

      if (account && account.status !== "ACTIVE") {
        throw new StaffIdentityError("TEACHER_ACCOUNT_SUSPENDED");
      }

      if (!account) {
        const placeholderHash = await hashPassword(generatePlaceholderPassword());
        account = await this.accounts.create({
          email,
          passwordHash: placeholderHash,
          status: "ACTIVE",
          createdByActorType: "SCHOOL_ADMIN",
          createdByActorId: identity.staffAccountId,
          requiresPasswordSetup: true,
        });
      }

      let membership = await this.memberships.findByStaffAccountAndTenant(account.id, identity.tenantId);
      if (membership) {
        if (membership.status === "ACTIVE") {
          throw new StaffIdentityError("MEMBERSHIP_ALREADY_ACTIVE");
        }
        if (membership.status === "SUSPENDED") {
          throw new StaffIdentityError("MEMBERSHIP_SUSPENDED_USE_REACTIVATE");
        }
        // status is INVITED or REVOKED here.
        const pending = await this.invitations.findPendingByMembership(membership.id, identity.tenantId);
        if (pending) {
          throw new StaffIdentityError("INVITATION_ALREADY_PENDING");
        }
        if (membership.status === "REVOKED") {
          // Re-invite: REVOKED -> INVITED on the SAME row (02_35 §11bis.2), never a new membership row.
          const reactivated = await this.memberships.updateStatus(membership.id, identity.tenantId, "INVITED");
          if (!reactivated) throw new Error("staff_tenant_membership: updateStatus produced no row");
          membership = reactivated;
        }
      } else {
        membership = await this.memberships.create({
          staffAccountId: account.id,
          tenantId: identity.tenantId,
          role: "TEACHER",
          status: "INVITED",
        });
      }

      const plaintextToken = generateToken(SESSION_TOKEN_BYTES);
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const invitation = await this.invitations.create({
        staffTenantMembershipId: membership.id,
        tenantId: identity.tenantId,
        tokenHash: hashToken(plaintextToken),
        issuedByStaffAccountId: identity.staffAccountId,
        expiresAt,
      });

      const result: CreateStaffInvitationResult = {
        invitationId: invitation.id,
        staffTenantMembershipId: membership.id,
        email: account.email,
        role: "TEACHER",
        status: "INVITED",
        expiresAt: expiresAt.toISOString(),
        acceptanceToken: plaintextToken,
        identityReused,
        createdAt: invitation.createdAt.toISOString(),
      };

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        // Never persist the plaintext token in the idempotency-record replay cache.
        response: { ...result, acceptanceToken: "[REDACTED]" },
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_invitation_issued",
        targetType: "staff_tenant_membership",
        targetId: membership.id,
        result: "SUCCESS",
        metadataRedacted: { identityReused },
      });

      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /**
   * `POST /staff/invitations/accept` (02_35 §11bis.3) — no staff session
   * required; the one-time token itself is the credential. Deliberately
   * NOT idempotency-key-gated (02_35 §11bis.11): the token's own
   * `consumed_at` already makes a second attempt with the same token
   * naturally rejected (INVITATION_ALREADY_CONSUMED).
   */
  async acceptInvitation(input: { token: string; password: string | undefined }): Promise<AcceptStaffInvitationResult> {
    const invitation = await this.invitations.findByTokenHash(hashToken(input.token));
    // Anti-enumeration (02_35 §13 convention): unknown token and revoked
    // token both resolve to the same NOT_FOUND response — a revoked
    // invitation should behave, from the invitee's perspective, exactly
    // as if it never existed.
    if (!invitation || invitation.revokedAt) {
      throw new StaffIdentityError("INVITATION_NOT_FOUND");
    }
    if (invitation.consumedAt) {
      throw new StaffIdentityError("INVITATION_ALREADY_CONSUMED");
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new StaffIdentityError("INVITATION_EXPIRED");
    }

    const membership = await this.memberships.findById(invitation.staffTenantMembershipId, invitation.tenantId);
    if (!membership) {
      throw new StaffIdentityError("INVITATION_NOT_FOUND");
    }
    const account = await this.accounts.findById(membership.staffAccountId);
    if (!account) {
      throw new StaffIdentityError("INVITATION_NOT_FOUND");
    }

    if (account.requiresPasswordSetup) {
      if (!input.password) {
        throw new StaffIdentityError("VALIDATION_ERROR", "password is required for a new identity.");
      }
      const passwordHash = await hashPassword(input.password);
      await this.accounts.setPasswordAndClearSetupFlag(account.id, passwordHash);
    } else if (input.password) {
      throw new StaffIdentityError("VALIDATION_ERROR", "password must be omitted when the identity already has a credential.");
    }

    await this.invitations.consume(invitation.id, invitation.tenantId);
    const activated = await this.memberships.updateStatus(membership.id, invitation.tenantId, "ACTIVE");
    if (!activated) throw new Error("staff_tenant_membership: updateStatus produced no row");

    await this.audit.record({
      tenantId: invitation.tenantId,
      actorType: "STAFF",
      actorId: account.id,
      action: "staff_invitation_accepted",
      targetType: "staff_tenant_membership",
      targetId: membership.id,
      result: "SUCCESS",
    });

    return { staffTenantMembershipId: membership.id, status: "ACTIVE", email: account.email };
  }
}
