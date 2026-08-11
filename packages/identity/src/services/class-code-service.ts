import type { Pool } from "pg";
import { IdentityError } from "../errors";
import { normalizeClassCode } from "../normalize";
import { hashClassCode } from "../crypto/class-code";
import { ClassAccessCodeRepository } from "../repository/class-access-code-repository";
import { SchoolClassRepository } from "../repository/school-class-repository";
import { TenantRepository } from "../repository/tenant-repository";
import { AuditRepository } from "../repository/audit-repository";
import { checkFixedWindow, RATE_LIMITS } from "../rate-limit/fixed-window";

export interface ClassCodeResolution {
  tenantPublicId: string;
  classPublicId: string;
  schoolName: string;
  requiresAlias: true;
  requiresPin: true;
}

/**
 * `POST /web-auth/class-code/resolve` (02_26 §30.1/§30.2). Never
 * distinguishes an inexistent, expired or revoked code — every failure
 * cause collapses to the same `CLASS_CODE_INVALID`; the real cause is
 * recorded only in the internal audit log.
 */
export class ClassCodeService {
  private readonly codes: ClassAccessCodeRepository;
  private readonly classes: SchoolClassRepository;
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;

  /** `pepper`: required, no default — see `crypto/class-code.ts#decodeClassCodePepper`. */
  constructor(
    private readonly pool: Pool,
    private readonly pepper: Buffer,
  ) {
    this.codes = new ClassAccessCodeRepository(pool);
    this.classes = new SchoolClassRepository(pool);
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async resolve(rawClassCode: string, clientIp: string): Promise<ClassCodeResolution> {
    const ipLimit = await checkFixedWindow(this.pool, RATE_LIMITS.CLASS_CODE_RESOLVE_IP, clientIp);
    if (!ipLimit.allowed) {
      throw new IdentityError("RATE_LIMITED", "class-code/resolve IP rate limit exceeded", {
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      });
    }

    const normalized = normalizeClassCode(rawClassCode);
    const codeHash = hashClassCode(normalized, this.pepper);

    const codeLimit = await checkFixedWindow(this.pool, RATE_LIMITS.CLASS_CODE_RESOLVE_CODE, codeHash);
    if (!codeLimit.allowed) {
      throw new IdentityError("RATE_LIMITED", "class-code/resolve per-code rate limit exceeded", {
        retryAfterSeconds: codeLimit.retryAfterSeconds,
      });
    }

    const record = await this.codes.findActiveByCodeHash(codeHash);
    const isUsable = record !== null && (record.expiresAt === null || record.expiresAt > new Date());

    if (!isUsable) {
      await this.audit.record({
        tenantId: record?.tenantId ?? null,
        actorType: "STUDENT",
        action: "student_access_failed",
        targetType: "class_access_code",
        result: "FAILURE",
        metadataRedacted: { reason: record === null ? "NOT_FOUND" : "EXPIRED" },
      });
      throw new IdentityError("CLASS_CODE_INVALID");
    }

    const schoolClass = await this.classes.findById(record.classId, record.tenantId);
    const tenant = schoolClass ? await this.tenants.findById(schoolClass.tenantId) : null;
    if (!schoolClass || !tenant) {
      // Should be unreachable given the composite tenant-scoped FKs — kept
      // as a defensive fallback that still returns the uniform public
      // error rather than a 500 revealing internal inconsistency.
      await this.audit.record({
        tenantId: record.tenantId,
        actorType: "STUDENT",
        action: "student_access_failed",
        targetType: "class_access_code",
        targetId: record.id,
        result: "FAILURE",
        metadataRedacted: { reason: "DANGLING_REFERENCE" },
      });
      throw new IdentityError("CLASS_CODE_INVALID");
    }

    // School Pilot Readiness Tranche A (02_38 §10): a SUSPENDED tenant's
    // students cannot start a new class-code session either. Same
    // uniform CLASS_CODE_INVALID as any other failure cause here — the
    // resolve endpoint never reveals tenant lifecycle state to a
    // student-facing anonymous caller.
    if (tenant.status !== "ACTIVE") {
      await this.audit.record({
        tenantId: tenant.id,
        actorType: "STUDENT",
        action: "student_access_failed",
        targetType: "class_access_code",
        targetId: record.id,
        result: "FAILURE",
        metadataRedacted: { reason: "TENANT_NOT_ACTIVE" },
      });
      throw new IdentityError("CLASS_CODE_INVALID");
    }

    await this.audit.record({
      tenantId: tenant.id,
      actorType: "STUDENT",
      action: "student_access_started",
      targetType: "class_access_code",
      targetId: record.id,
      result: "SUCCESS",
    });

    return {
      tenantPublicId: tenant.publicId,
      classPublicId: schoolClass.publicId,
      schoolName: tenant.name,
      requiresAlias: true,
      requiresPin: true,
    };
  }
}
