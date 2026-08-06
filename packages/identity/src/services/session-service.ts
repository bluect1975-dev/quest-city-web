import type { Pool } from "pg";
import { IdentityError } from "../errors";
import { normalizeAlias, normalizeClassCode } from "../normalize";
import { CSRF_TOKEN_BYTES, SESSION_TOKEN_BYTES, generateToken, hashToken, verifyTokenHash } from "../crypto/token";
import { hashClassCode } from "../crypto/class-code";
import { verifyPin } from "../crypto/pin";
import { ClassAccessCodeRepository } from "../repository/class-access-code-repository";
import { SchoolClassRepository } from "../repository/school-class-repository";
import { TenantRepository } from "../repository/tenant-repository";
import { SchoolEnrollmentRepository, type SchoolEnrollment } from "../repository/school-enrollment-repository";
import { StudentProfileRepository } from "../repository/student-profile-repository";
import { StudentSessionRepository, type StudentSession } from "../repository/student-session-repository";
import { AuditRepository } from "../repository/audit-repository";
import { checkFixedWindow, RATE_LIMITS } from "../rate-limit/fixed-window";
import { DEFAULT_SESSION_SECURITY_CONFIG, type SessionSecurityConfig } from "../config";

export interface SessionStartResult {
  studentPublicId: string;
  tenantPublicId: string;
  classPublicId: string;
  sessionExpiresAt: Date;
  sessionToken: string;
  csrfToken: string;
}

export interface SessionRefreshResult {
  sessionExpiresAt: Date;
  sessionToken: string;
  csrfToken: string;
}

export interface StudentContext {
  studentPublicId: string;
  tenantPublicId: string;
  classPublicId: string;
  enrollmentStatus: "ACTIVE" | "SUSPENDED";
  displayAlias: string;
}

/**
 * `POST /web-auth/session/*` and `GET /me/student-context` (02_26 §30).
 * Owns the full session lifecycle: start, refresh (full rotation, never
 * extends the absolute TTL), idempotent logout, and context lookup.
 */
export class SessionService {
  private readonly codes: ClassAccessCodeRepository;
  private readonly classes: SchoolClassRepository;
  private readonly tenants: TenantRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly profiles: StudentProfileRepository;
  private readonly sessions: StudentSessionRepository;
  private readonly audit: AuditRepository;

  /** `pepper`: required, no default — see `crypto/class-code.ts#decodeClassCodePepper`. */
  constructor(
    private readonly pool: Pool,
    private readonly pepper: Buffer,
    private readonly config: SessionSecurityConfig = DEFAULT_SESSION_SECURITY_CONFIG,
  ) {
    this.codes = new ClassAccessCodeRepository(pool);
    this.classes = new SchoolClassRepository(pool);
    this.tenants = new TenantRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.profiles = new StudentProfileRepository(pool);
    this.sessions = new StudentSessionRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async start(input: { classCode: string; accessAlias: string; pin: string; clientIp: string }): Promise<SessionStartResult> {
    const ipLimit = await checkFixedWindow(this.pool, RATE_LIMITS.SESSION_START_IP, input.clientIp);
    if (!ipLimit.allowed) {
      throw new IdentityError("RATE_LIMITED", "session/start IP rate limit exceeded", {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }

    const normalizedCode = normalizeClassCode(input.classCode);
    const codeHash = hashClassCode(normalizedCode, this.pepper);
    const codeRecord = await this.codes.findActiveByCodeHash(codeHash);
    const codeUsable = codeRecord !== null && (codeRecord.expiresAt === null || codeRecord.expiresAt > new Date());
    if (!codeUsable) {
      throw new IdentityError("CLASS_CODE_INVALID");
    }

    const schoolClass = await this.classes.findById(codeRecord.classId, codeRecord.tenantId);
    const tenant = schoolClass ? await this.tenants.findById(schoolClass.tenantId) : null;
    if (!schoolClass || !tenant) {
      throw new IdentityError("CLASS_CODE_INVALID");
    }
    if (tenant.status !== "ACTIVE") {
      throw new IdentityError("TENANT_ACCESS_DENIED");
    }

    const aliasNormalized = normalizeAlias(input.accessAlias);
    const enrollmentBucketKey = `${schoolClass.id}:${aliasNormalized}`;
    const enrollmentLimit = await checkFixedWindow(this.pool, RATE_LIMITS.SESSION_START_ENROLLMENT, enrollmentBucketKey);
    if (!enrollmentLimit.allowed) {
      throw new IdentityError("RATE_LIMITED", "session/start per-enrollment rate limit exceeded", {
        retryAfterSeconds: enrollmentLimit.retryAfterSeconds,
      });
    }

    let enrollment = await this.enrollments.findByClassAndAliasNormalized(schoolClass.id, aliasNormalized);
    if (!enrollment) {
      await this.audit.record({
        tenantId: tenant.id,
        actorType: "STUDENT",
        action: "student_access_failed",
        targetType: "school_enrollment",
        result: "FAILURE",
        metadataRedacted: { reason: "ALIAS_NOT_FOUND" },
      });
      throw new IdentityError("ACCESS_CREDENTIALS_INVALID");
    }

    if (enrollment.status === "SUSPENDED") {
      await this.recordAccessFailure(tenant.id, enrollment, "ENROLLMENT_SUSPENDED");
      throw new IdentityError("ENROLLMENT_SUSPENDED");
    }
    if (enrollment.status === "LEFT" || enrollment.status === "ARCHIVED") {
      await this.recordAccessFailure(tenant.id, enrollment, `ENROLLMENT_${enrollment.status}`);
      throw new IdentityError("ACCESS_CREDENTIALS_INVALID");
    }

    const pinValid = await verifyPin(input.pin, enrollment.pinHash);
    if (!pinValid) {
      await this.recordAccessFailure(tenant.id, enrollment, "PIN_MISMATCH");
      throw new IdentityError("ACCESS_CREDENTIALS_INVALID");
    }

    if (enrollment.status === "INVITED") {
      const activated = await this.enrollments.activateIfInvited(enrollment.id, tenant.id);
      if (activated) {
        enrollment = activated;
        await this.audit.record({
          tenantId: tenant.id,
          actorType: "STUDENT",
          actorId: enrollment.studentProfileId,
          action: "enrollment_activated",
          targetType: "school_enrollment",
          targetId: enrollment.id,
          result: "SUCCESS",
        });
      }
    }

    const profile = await this.profiles.findById(enrollment.studentProfileId, tenant.id);
    if (!profile) {
      throw new IdentityError("ACCESS_CREDENTIALS_INVALID");
    }

    const sessionToken = generateToken(SESSION_TOKEN_BYTES);
    const csrfToken = generateToken(CSRF_TOKEN_BYTES);
    const expiresAt = new Date(Date.now() + this.config.absoluteTtlSeconds * 1000);

    await this.sessions.create({
      tenantId: tenant.id,
      studentProfileId: profile.id,
      enrollmentId: enrollment.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
    });

    await this.audit.record({
      tenantId: tenant.id,
      actorType: "STUDENT",
      actorId: profile.id,
      action: "student_session_created",
      targetType: "student_profile",
      targetId: profile.id,
      result: "SUCCESS",
    });

    return {
      studentPublicId: profile.studentPublicId,
      tenantPublicId: tenant.publicId,
      classPublicId: schoolClass.publicId,
      sessionExpiresAt: expiresAt,
      sessionToken,
      csrfToken,
    };
  }

  async refresh(input: { sessionToken: string; csrfToken: string }): Promise<SessionRefreshResult> {
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    if (!verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new IdentityError("CSRF_INVALID");
    }

    const newSessionToken = generateToken(SESSION_TOKEN_BYTES);
    const newCsrfToken = generateToken(CSRF_TOKEN_BYTES);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessions = new StudentSessionRepository(client);
      const created = await sessions.create({
        tenantId: session.tenantId,
        studentProfileId: session.studentProfileId,
        enrollmentId: session.enrollmentId,
        tokenHash: hashToken(newSessionToken),
        csrfTokenHash: hashToken(newCsrfToken),
        // Rotation never extends the absolute TTL (02_26 §30.1) — carried over unchanged.
        expiresAt: session.expiresAt,
        rotatedFrom: session.id,
      });
      await sessions.revoke(session.id, session.tenantId, "ROTATED");
      await client.query("COMMIT");
      await this.audit.record({
        tenantId: session.tenantId,
        actorType: "STUDENT",
        actorId: session.studentProfileId,
        action: "student_session_created",
        targetType: "student_session",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { rotatedFrom: session.id },
      });
      return { sessionExpiresAt: session.expiresAt, sessionToken: newSessionToken, csrfToken: newCsrfToken };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Always succeeds and never reveals prior session state (02_26 §30.1:
   * idempotent, no deducible prior state). CSRF is verified only when a
   * currently-valid session is presented — with no valid session there is
   * nothing to protect, so the check is skipped rather than failing.
   */
  async logout(input: { sessionToken: string | null; csrfToken: string | null }): Promise<void> {
    if (!input.sessionToken) {
      return;
    }
    const session = await this.resolveActiveSession(input.sessionToken);
    if (!session) {
      return;
    }
    if (!input.csrfToken || !verifyTokenHash(input.csrfToken, session.csrfTokenHash)) {
      throw new IdentityError("CSRF_INVALID");
    }
    await this.sessions.revoke(session.id, session.tenantId, "USER_LOGOUT");
    await this.audit.record({
      tenantId: session.tenantId,
      actorType: "STUDENT",
      actorId: session.studentProfileId,
      action: "student_session_revoked",
      targetType: "student_session",
      targetId: session.id,
      result: "SUCCESS",
      metadataRedacted: { reason: "USER_LOGOUT" },
    });
  }

  async getContext(rawSessionToken: string): Promise<StudentContext> {
    const session = await this.resolveActiveSession(rawSessionToken);
    if (!session) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    await this.sessions.touchLastSeen(session.id, session.tenantId);

    const [profile, enrollment, tenant] = await Promise.all([
      this.profiles.findById(session.studentProfileId, session.tenantId),
      this.enrollments.findById(session.enrollmentId, session.tenantId),
      this.tenants.findById(session.tenantId),
    ]);
    if (!profile || !enrollment || !tenant) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    const schoolClass = await this.classes.findById(enrollment.classId, session.tenantId);
    if (!schoolClass) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    // OpenAPI v1.3 StudentContextResponse.enrollmentStatus is narrower
    // (ACTIVE|SUSPENDED) than the full internal enum. Any other status
    // should be unreachable here (a session is only created while
    // ACTIVE/INVITED, and INVITED is activated synchronously) — kept as a
    // defensive fallback that never leaks the raw internal value.
    const enrollmentStatus: StudentContext["enrollmentStatus"] = enrollment.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";

    return {
      studentPublicId: profile.studentPublicId,
      tenantPublicId: tenant.publicId,
      classPublicId: schoolClass.publicId,
      enrollmentStatus,
      displayAlias: enrollment.accessAlias,
    };
  }

  /**
   * Resolves an active session from its raw cookie token. A session found
   * to be past its absolute or inactivity deadline is lazily revoked with
   * the matching reason (ABSOLUTE_EXPIRY / INACTIVITY_TIMEOUT) as a side
   * effect, so the audit trail and `revoked_reason` stay accurate instead
   * of leaving a merely-timed-out row looking un-revoked forever.
   */
  private async resolveActiveSession(rawSessionToken: string): Promise<StudentSession | null> {
    const tokenHash = hashToken(rawSessionToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session || session.revokedAt) {
      return null;
    }
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.sessions.revoke(session.id, session.tenantId, "ABSOLUTE_EXPIRY");
      await this.audit.record({
        tenantId: session.tenantId,
        actorType: "SYSTEM",
        actorId: session.studentProfileId,
        action: "student_session_revoked",
        targetType: "student_session",
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
        actorId: session.studentProfileId,
        action: "student_session_revoked",
        targetType: "student_session",
        targetId: session.id,
        result: "SUCCESS",
        metadataRedacted: { reason: "INACTIVITY_TIMEOUT" },
      });
      return null;
    }
    return session;
  }

  private async recordAccessFailure(tenantId: string, enrollment: SchoolEnrollment, reason: string): Promise<void> {
    await this.audit.record({
      tenantId,
      actorType: "STUDENT",
      actorId: enrollment.studentProfileId,
      action: "student_access_failed",
      targetType: "school_enrollment",
      targetId: enrollment.id,
      result: "FAILURE",
      metadataRedacted: { reason },
    });
  }
}
