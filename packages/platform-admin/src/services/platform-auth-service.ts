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
import { StaffAccountRepository, verifyPassword } from "@quest-city-web/staff-identity";
import { PlatformAdminError } from "../errors";
import {
  DEFAULT_PLATFORM_ADMIN_SESSION_SECURITY_CONFIG,
  type PlatformAdminSessionSecurityConfig,
} from "../config";
import { PlatformAdminGrantRepository, type Capability } from "../repository/platform-admin-grant-repository";
import { PlatformAdminSessionRepository, type PlatformAdminSession } from "../repository/platform-admin-session-repository";

/** Own traffic class from staff/student login (02_35 §4.5 precedent extended to platform scope). */
const PLATFORM_LOGIN_IP_RATE_LIMIT: RateLimitDimension = { scope: "PLATFORM_LOGIN_IP", limit: 20, windowMs: 15 * 60 * 1000 };
const PLATFORM_LOGIN_EMAIL_RATE_LIMIT: RateLimitDimension = {
  scope: "PLATFORM_LOGIN_EMAIL",
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

export interface PlatformAdminSessionStartResult {
  csrfToken: string;
  sessionToken: string;
  absoluteExpiresAt: Date;
  capabilities: Capability[];
}

export interface PlatformAdminSessionRefreshResult {
  csrfToken: string;
  sessionToken: string;
  absoluteExpiresAt: Date;
}

/** Resolved once per request by `requirePlatformAdminIdentity` -- carries the capability set every route/service checks against. */
export interface PlatformAdminIdentity {
  staffAccountId: string;
  platformAdminGrantId: string;
  capabilities: Capability[];
  csrfTokenHash: string;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `POST /platform-auth/session/*`, `POST /platform-auth/logout`, `GET
 * /me/platform-context`. Entirely separate lifecycle from
 * `StaffAuthService` -- distinct table (`platform_admin_session`),
 * distinct cookie (`qc_platform_session`) -- but reuses `staff_account`
 * for the identity row itself (02_38 §20: "Riusa staff_account") and the
 * same scrypt password format, FIXED_WINDOW rate limiter, and lockout
 * fields as staff auth, since a platform admin and a school staff member
 * are the same underlying credential class (both `staff_account`).
 */
export class PlatformAuthService {
  private readonly accounts: StaffAccountRepository;
  private readonly grants: PlatformAdminGrantRepository;
  private readonly sessions: PlatformAdminSessionRepository;
  private readonly audit: AuditRepository;

  constructor(
    private readonly pool: Pool,
    private readonly config: PlatformAdminSessionSecurityConfig = DEFAULT_PLATFORM_ADMIN_SESSION_SECURITY_CONFIG,
  ) {
    this.accounts = new StaffAccountRepository(pool);
    this.grants = new PlatformAdminGrantRepository(pool);
    this.sessions = new PlatformAdminSessionRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  /**
   * Anti-enumeration (same discipline as 02_35 §4.6): unknown email,
   * wrong password, inactive account, and "authenticated but no active
   * platform-admin standing" all converge on the same
   * PLATFORM_AUTH_REQUIRED response -- a school staff member's valid
   * staff_account credentials must never reveal, via a distinct error,
   * whether they also happen to hold platform admin standing.
   */
  async start(input: { email: string; password: string; clientIp: string }): Promise<PlatformAdminSessionStartResult> {
    const ipLimit = await checkFixedWindow(this.pool, PLATFORM_LOGIN_IP_RATE_LIMIT, input.clientIp);
    if (!ipLimit.allowed) {
      throw new PlatformAdminError("RATE_LIMITED", "platform-auth/session/start IP rate limit exceeded", {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }
    const email = normalizeEmail(input.email);
    const emailLimit = await checkFixedWindow(this.pool, PLATFORM_LOGIN_EMAIL_RATE_LIMIT, email);
    if (!emailLimit.allowed) {
      throw new PlatformAdminError("RATE_LIMITED", "platform-auth/session/start per-email rate limit exceeded", {
        retryAfterSeconds: emailLimit.retryAfterSeconds,
      });
    }

    const account = await this.accounts.findByEmail(email);
    if (!account) {
      await this.recordAuthFailure(null, "ACCOUNT_NOT_FOUND");
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      throw new PlatformAdminError("PLATFORM_ACCOUNT_LOCKED");
    }
    if (account.status !== "ACTIVE") {
      await this.recordAuthFailure(account.id, "ACCOUNT_NOT_ACTIVE");
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }

    const passwordValid = await verifyPassword(input.password, account.passwordHash);
    if (!passwordValid) {
      const { lockedUntil } = await this.accounts.recordFailedLogin(
        account.id,
        this.config.maxFailedLoginAttempts,
        this.config.lockoutDurationSeconds,
      );
      await this.recordAuthFailure(account.id, "PASSWORD_MISMATCH");
      if (lockedUntil) {
        throw new PlatformAdminError("PLATFORM_ACCOUNT_LOCKED");
      }
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }

    const grant = await this.grants.findByStaffAccountId(account.id);
    if (!grant || grant.status !== "ACTIVE") {
      await this.recordAuthFailure(account.id, "NO_ACTIVE_PLATFORM_ADMIN_GRANT");
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    const capabilities = await this.grants.listCapabilities(grant.id);

    const sessionToken = generateToken(SESSION_TOKEN_BYTES);
    const csrfToken = generateToken(CSRF_TOKEN_BYTES);
    const absoluteExpiresAt = new Date(Date.now() + this.config.absoluteTtlSeconds * 1000);

    await this.sessions.create({
      staffAccountId: account.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      absoluteExpiresAt,
    });
    await this.accounts.recordSuccessfulLogin(account.id);
    await this.audit.record({
      tenantId: null,
      actorType: "PLATFORM_ADMIN",
      actorId: account.id,
      action: "platform_admin.session_created",
      targetType: "staff_account",
      targetId: account.id,
      result: "SUCCESS",
    });

    return { csrfToken, sessionToken, absoluteExpiresAt, capabilities };
  }

  async refresh(input: { sessionToken: string; csrfToken: string }): Promise<PlatformAdminSessionRefreshResult> {
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    if (!verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }

    const newSessionToken = generateToken(SESSION_TOKEN_BYTES);
    const newCsrfToken = generateToken(CSRF_TOKEN_BYTES);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessions = new PlatformAdminSessionRepository(client);
      const created = await sessions.create({
        staffAccountId: session.staffAccountId,
        tokenHash: hashToken(newSessionToken),
        csrfTokenHash: hashToken(newCsrfToken),
        absoluteExpiresAt: session.absoluteExpiresAt,
        rotatedFrom: session.id,
      });
      await sessions.revoke(session.id, "ROTATED");
      await client.query("COMMIT");
      await this.audit.record({
        tenantId: null,
        actorType: "PLATFORM_ADMIN",
        actorId: session.staffAccountId,
        action: "platform_admin.session_created",
        targetType: "platform_admin_session",
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

  async logout(input: { sessionToken: string | null; csrfToken: string | null }): Promise<void> {
    if (!input.sessionToken) {
      return;
    }
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      return;
    }
    if (!input.csrfToken || !verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    await this.sessions.revoke(session.id, "USER_LOGOUT");
    await this.audit.record({
      tenantId: null,
      actorType: "PLATFORM_ADMIN",
      actorId: session.staffAccountId,
      action: "platform_admin.session_revoked",
      targetType: "platform_admin_session",
      targetId: session.id,
      result: "SUCCESS",
      metadataRedacted: { reason: "USER_LOGOUT" },
    });
  }

  /**
   * Resolves the full identity behind a platform session cookie. Every
   * platform route calls this exactly once per request -- there is no
   * separate "public" identity shape, since nothing in the platform
   * surface is usable without an active grant.
   */
  async resolveIdentity(rawSessionToken: string): Promise<PlatformAdminIdentity> {
    const session = await this.resolveActiveSession(rawSessionToken);
    if (!session) {
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    const grant = await this.grants.findByStaffAccountId(session.staffAccountId);
    if (!grant || grant.status !== "ACTIVE") {
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    await this.sessions.touchLastSeen(session.id);
    const capabilities = await this.grants.listCapabilities(grant.id);
    return {
      staffAccountId: session.staffAccountId,
      platformAdminGrantId: grant.id,
      capabilities,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  private async resolveActiveSession(rawSessionToken: string): Promise<PlatformAdminSession | null> {
    const tokenHash = hashToken(rawSessionToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session || session.revokedAt) {
      return null;
    }
    const now = Date.now();
    if (session.absoluteExpiresAt.getTime() <= now) {
      await this.sessions.revoke(session.id, "ABSOLUTE_EXPIRY");
      await this.audit.record({
        tenantId: null,
        actorType: "SYSTEM",
        actorId: session.staffAccountId,
        action: "platform_admin.session_revoked",
        targetType: "platform_admin_session",
        targetId: session.id,
        result: "SUCCESS",
        metadataRedacted: { reason: "ABSOLUTE_EXPIRY" },
      });
      return null;
    }
    const inactivityDeadline = session.lastSeenAt.getTime() + this.config.inactivityTtlSeconds * 1000;
    if (inactivityDeadline <= now) {
      await this.sessions.revoke(session.id, "INACTIVITY_TIMEOUT");
      await this.audit.record({
        tenantId: null,
        actorType: "SYSTEM",
        actorId: session.staffAccountId,
        action: "platform_admin.session_revoked",
        targetType: "platform_admin_session",
        targetId: session.id,
        result: "SUCCESS",
        metadataRedacted: { reason: "INACTIVITY_TIMEOUT" },
      });
      return null;
    }
    return session;
  }

  private async recordAuthFailure(staffAccountId: string | null, reason: string): Promise<void> {
    await this.audit.record({
      tenantId: null,
      actorType: "PLATFORM_ADMIN",
      actorId: staffAccountId,
      action: "platform_admin.login_failed",
      targetType: "staff_account",
      targetId: staffAccountId,
      result: "FAILURE",
      metadataRedacted: { reason },
    });
  }
}
