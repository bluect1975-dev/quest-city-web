import type { Pool } from "pg";
import {
  AuditRepository,
  checkFixedWindow,
  CSRF_TOKEN_BYTES,
  generateToken,
  hashToken,
  SESSION_TOKEN_BYTES,
  verifyTokenHash,
  type RateLimitDimension,
} from "@quest-city-web/identity";
import { StaffIdentityError } from "../errors";
import { DEFAULT_STAFF_SESSION_SECURITY_CONFIG, type StaffSessionSecurityConfig } from "../config";
import { verifyPassword } from "../crypto/password";
import { StaffAccountRepository } from "../repository/staff-account-repository";
import { StaffTenantMembershipRepository, type StaffRole } from "../repository/staff-tenant-membership-repository";
import { StaffClassAssignmentRepository } from "../repository/staff-class-assignment-repository";
import { StaffSessionRepository, type StaffSession } from "../repository/staff-session-repository";

/** Independent rate-limit dimensions from WEB-M1's student RATE_LIMITS (identity package) — staff login is a distinct traffic class. */
const STAFF_LOGIN_IP_RATE_LIMIT: RateLimitDimension = { scope: "STAFF_LOGIN_IP", limit: 20, windowMs: 15 * 60 * 1000 };
const STAFF_LOGIN_EMAIL_RATE_LIMIT: RateLimitDimension = {
  scope: "STAFF_LOGIN_EMAIL",
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

export interface StaffSessionStartResult {
  csrfToken: string;
  tenantId: string;
  role: StaffRole;
  sessionToken: string;
  absoluteExpiresAt: Date;
}

export interface StaffSessionRefreshResult {
  csrfToken: string;
  sessionToken: string;
  absoluteExpiresAt: Date;
}

export interface StaffContext {
  staffAccountId: string;
  tenantId: string;
  role: StaffRole;
  /** Explicit class id list for TEACHER; null for SCHOOL_ADMIN (whole-tenant scope, 02_35 §3.2). */
  classScope: string[] | null;
}

export interface StaffInternalIdentity extends StaffContext {
  staffTenantMembershipId: string;
  /** The active session's CSRF token hash — lets callers verify an `x-csrf-token` header without a second session lookup (02_35 §4.4). */
  csrfTokenHash: string;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `POST /staff-auth/session/*`, `POST /staff-auth/logout`, `GET
 * /me/staff-context` (02_35 §4). Entirely separate lifecycle from
 * `@quest-city-web/identity`'s `SessionService` — distinct table, cookie,
 * and credential model (02_35 §2.1) — but reuses the same token
 * generation/hashing primitives and FIXED_WINDOW rate limiter, which are
 * generic infrastructure, not identity-specific.
 */
export class StaffAuthService {
  private readonly accounts: StaffAccountRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly classAssignments: StaffClassAssignmentRepository;
  private readonly sessions: StaffSessionRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly pool: Pool,
    private readonly config: StaffSessionSecurityConfig = DEFAULT_STAFF_SESSION_SECURITY_CONFIG,
  ) {
    this.accounts = new StaffAccountRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.classAssignments = new StaffClassAssignmentRepository(pool);
    this.sessions = new StaffSessionRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  /**
   * Anti-enumeration (02_35 §4.6): every failure path — unknown email,
   * wrong password, inactive account, unresolvable tenant — converges on
   * the same STAFF_AUTH_REQUIRED response with no distinguishing detail,
   * except STAFF_ACCOUNT_LOCKED, which is deliberately distinct per the
   * canonical contract (02_35 §4.5).
   */
  async start(input: {
    email: string;
    password: string;
    tenantId?: string | undefined;
    clientIp: string;
  }): Promise<StaffSessionStartResult> {
    const ipLimit = await checkFixedWindow(this.pool, STAFF_LOGIN_IP_RATE_LIMIT, input.clientIp);
    if (!ipLimit.allowed) {
      throw new StaffIdentityError("RATE_LIMITED", "staff-auth/session/start IP rate limit exceeded", {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }
    const email = normalizeEmail(input.email);
    const emailLimit = await checkFixedWindow(this.pool, STAFF_LOGIN_EMAIL_RATE_LIMIT, email);
    if (!emailLimit.allowed) {
      throw new StaffIdentityError("RATE_LIMITED", "staff-auth/session/start per-email rate limit exceeded", {
        retryAfterSeconds: emailLimit.retryAfterSeconds,
      });
    }

    const account = await this.accounts.findByEmail(email);
    if (!account) {
      await this.audit.record({
        tenantId: null,
        actorType: "STAFF",
        action: "staff_login_failed",
        targetType: "staff_account",
        result: "FAILURE",
        metadataRedacted: { reason: "ACCOUNT_NOT_FOUND" },
      });
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED", "Credenziali staff non valide.");
    }

    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      throw new StaffIdentityError("STAFF_ACCOUNT_LOCKED", "Account temporaneamente bloccato.");
    }
    if (account.status !== "ACTIVE") {
      await this.recordLoginFailure(account.id, "ACCOUNT_NOT_ACTIVE");
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED", "Credenziali staff non valide.");
    }

    const passwordValid = await verifyPassword(input.password, account.passwordHash);
    if (!passwordValid) {
      const { lockedUntil } = await this.accounts.recordFailedLogin(
        account.id,
        this.config.maxFailedLoginAttempts,
        this.config.lockoutDurationSeconds,
      );
      await this.recordLoginFailure(account.id, "PASSWORD_MISMATCH");
      if (lockedUntil) {
        throw new StaffIdentityError("STAFF_ACCOUNT_LOCKED", "Account temporaneamente bloccato.");
      }
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED", "Credenziali staff non valide.");
    }

    const activeMemberships = (await this.memberships.findByStaffAccount(account.id)).filter((m) => m.status === "ACTIVE");
    const membership = input.tenantId
      ? activeMemberships.find((m) => m.tenantId === input.tenantId)
      : activeMemberships.length === 1
        ? activeMemberships[0]
        : undefined;
    if (!membership) {
      await this.recordLoginFailure(account.id, "NO_RESOLVABLE_TENANT_MEMBERSHIP");
      throw new StaffIdentityError(
        "VALIDATION_ERROR",
        "tenantId è obbligatorio quando l'account ha più di una membership attiva.",
      );
    }

    const sessionToken = generateToken(SESSION_TOKEN_BYTES);
    const csrfToken = generateToken(CSRF_TOKEN_BYTES);
    const absoluteExpiresAt = new Date(Date.now() + this.config.absoluteTtlSeconds * 1000);

    await this.sessions.create({
      staffAccountId: account.id,
      tenantId: membership.tenantId,
      staffTenantMembershipId: membership.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      absoluteExpiresAt,
    });
    await this.accounts.recordSuccessfulLogin(account.id);
    await this.audit.record({
      tenantId: membership.tenantId,
      actorType: "STAFF",
      actorId: account.id,
      action: "staff_session_created",
      targetType: "staff_account",
      targetId: account.id,
      result: "SUCCESS",
    });

    return { csrfToken, tenantId: membership.tenantId, role: membership.role, sessionToken, absoluteExpiresAt };
  }

  /** Full rotation; absolute TTL is never extended by a refresh (02_35 §4.4). */
  async refresh(input: { sessionToken: string; csrfToken: string }): Promise<StaffSessionRefreshResult> {
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }
    if (!verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }

    const newSessionToken = generateToken(SESSION_TOKEN_BYTES);
    const newCsrfToken = generateToken(CSRF_TOKEN_BYTES);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessions = new StaffSessionRepository(client);
      const created = await sessions.create({
        staffAccountId: session.staffAccountId,
        tenantId: session.tenantId,
        staffTenantMembershipId: session.staffTenantMembershipId,
        tokenHash: hashToken(newSessionToken),
        csrfTokenHash: hashToken(newCsrfToken),
        absoluteExpiresAt: session.absoluteExpiresAt,
        rotatedFrom: session.id,
      });
      await sessions.revoke(session.id, session.tenantId, "ROTATED");
      await client.query("COMMIT");
      await this.audit.record({
        tenantId: session.tenantId,
        actorType: "STAFF",
        actorId: session.staffAccountId,
        action: "staff_session_created",
        targetType: "staff_session",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { rotatedFrom: session.id },
      });
      return { csrfToken: newCsrfToken, sessionToken: newSessionToken, absoluteExpiresAt: session.absoluteExpiresAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Always succeeds and never reveals prior session state (02_35 §4.4, same idempotent-logout discipline as WEB-M1). */
  async logout(input: { sessionToken: string | null; csrfToken: string | null }): Promise<void> {
    if (!input.sessionToken) {
      return;
    }
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      return;
    }
    if (!input.csrfToken || !verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    await this.sessions.revoke(session.id, session.tenantId, "USER_LOGOUT");
    await this.audit.record({
      tenantId: session.tenantId,
      actorType: "STAFF",
      actorId: session.staffAccountId,
      action: "staff_session_revoked",
      targetType: "staff_session",
      targetId: session.id,
      result: "SUCCESS",
      metadataRedacted: { reason: "USER_LOGOUT" },
    });
  }

  async getContext(rawSessionToken: string): Promise<StaffContext> {
    const identity = await this.resolveInternalIdentity(rawSessionToken);
    return {
      staffAccountId: identity.staffAccountId,
      tenantId: identity.tenantId,
      role: identity.role,
      classScope: identity.classScope,
    };
  }

  /**
   * Resolves the full internal identity behind a staff session cookie —
   * used by `apps/api`'s authorization middleware, which needs
   * `staffTenantMembershipId` (for `StaffClassAssignmentRepository`
   * lookups) in addition to the public-facing `StaffContext` shape.
   */
  async resolveInternalIdentity(rawSessionToken: string): Promise<StaffInternalIdentity> {
    const session = await this.resolveActiveSession(rawSessionToken);
    if (!session) {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }
    const membership = await this.memberships.findById(session.staffTenantMembershipId, session.tenantId);
    if (!membership || membership.status !== "ACTIVE") {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }
    await this.sessions.touchLastSeen(session.id, session.tenantId);

    let classScope: string[] | null = null;
    if (membership.role === "TEACHER") {
      const assignments = await this.classAssignments.findByMembership(membership.id, membership.tenantId);
      classScope = assignments.map((a) => a.classId);
    }

    return {
      staffAccountId: session.staffAccountId,
      tenantId: session.tenantId,
      staffTenantMembershipId: membership.id,
      role: membership.role,
      classScope,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  /**
   * Resolves an active session from its raw cookie token, lazily
   * revoking one found past its absolute or inactivity deadline (same
   * discipline as `@quest-city-web/identity`'s `SessionService`).
   */
  private async resolveActiveSession(rawSessionToken: string): Promise<StaffSession | null> {
    const tokenHash = hashToken(rawSessionToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session || session.revokedAt) {
      return null;
    }
    const now = Date.now();
    if (session.absoluteExpiresAt.getTime() <= now) {
      await this.sessions.revoke(session.id, session.tenantId, "ABSOLUTE_EXPIRY");
      await this.audit.record({
        tenantId: session.tenantId,
        actorType: "SYSTEM",
        actorId: session.staffAccountId,
        action: "staff_session_revoked",
        targetType: "staff_session",
        targetId: session.id,
        result: "SUCCESS",
        metadataRedacted: { reason: "ABSOLUTE_EXPIRY" },
      });
      return null;
    }
    const inactivityDeadline = session.lastSeenAt.getTime() + this.config.inactivityTtlSeconds * 1000;
    if (inactivityDeadline <= now) {
      await this.sessions.revoke(session.id, session.tenantId, "INACTIVITY_TIMEOUT");
      await this.audit.record({
        tenantId: session.tenantId,
        actorType: "SYSTEM",
        actorId: session.staffAccountId,
        action: "staff_session_revoked",
        targetType: "staff_session",
        targetId: session.id,
        result: "SUCCESS",
        metadataRedacted: { reason: "INACTIVITY_TIMEOUT" },
      });
      return null;
    }
    return session;
  }

  private async recordLoginFailure(staffAccountId: string, reason: string): Promise<void> {
    await this.audit.record({
      tenantId: null,
      actorType: "STAFF",
      actorId: staffAccountId,
      action: "staff_login_failed",
      targetType: "staff_account",
      targetId: staffAccountId,
      result: "FAILURE",
      metadataRedacted: { reason },
    });
  }
}
