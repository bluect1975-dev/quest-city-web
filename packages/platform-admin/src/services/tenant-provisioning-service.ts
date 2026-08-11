import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, TenantRepository, type Tenant } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

const PLATFORM_TENANT_CREATE_SCOPE = "platform_tenant_create";

export interface TenantProvisioningResult {
  id: string;
  publicId: string;
  type: Tenant["type"];
  status: Tenant["status"];
  name: string;
  createdAt: string;
}

function tenantCreateRequestHash(payload: { name: string }): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * `POST /platform/tenants` (02_38 §21, confirmed canonical by `02_26
 * v1.10` §32.3/§32.4; namespace and endpoint no longer "indicative" as
 * of `02_38 v1.1`). Creates only the tenant row itself -- no classes,
 * students, or demo content are ever auto-created (§9: "NON creare
 * automaticamente classi/studenti/demo content").
 *
 * Idempotency (`02_26 v1.10` §32.4): `Idempotency-Key` is required on
 * this operation. The request fingerprint (`tenantCreateRequestHash`)
 * covers only the semantically relevant field (`name`) -- never a
 * timestamp, correlation id, or other non-semantic value, so the same
 * logical request always produces the same fingerprint regardless of
 * when or how many times it is retried. The dedup scope is
 * `platform_tenant_create` with `tenantId: null` (migration 0007): no
 * tenant exists yet to scope the record to, so `scopeKey` is partitioned
 * by the *acting* Platform Admin's `staffAccountId` instead -- the same
 * `Idempotency-Key` value reused by two different admins is never
 * treated as the same request. Reuses `IdempotencyRecordRepository`
 * exactly as every other scope does; no second idempotency mechanism.
 */
export class TenantProvisioningService {
  private readonly tenants: TenantRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRecordRepository;

  constructor(private readonly pool: Pool) {
    this.tenants = new TenantRepository(pool);
    this.audit = new AuditRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
  }

  async createSchoolTenant(
    identity: PlatformAdminIdentity,
    input: { name: string; idempotencyKey: string },
  ): Promise<TenantProvisioningResult> {
    assertCapability(identity, "tenant.create");

    const name = input.name.trim();
    if (name.length === 0 || name.length > 200) {
      throw new PlatformAdminError("VALIDATION_ERROR", "name must be 1-200 characters.");
    }

    const scopeKey = `${identity.staffAccountId}:${input.idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: null,
      scope: PLATFORM_TENANT_CREATE_SCOPE,
      scopeKey,
      requestHash: tenantCreateRequestHash({ name }),
    });

    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as TenantProvisioningResult;
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
      const publicId = `sch_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const tenant = await this.tenants.create({ publicId, type: "SCHOOL", status: "ACTIVE", name });

      const result: TenantProvisioningResult = {
        id: tenant.id,
        publicId: tenant.publicId,
        type: tenant.type,
        status: tenant.status,
        name: tenant.name,
        createdAt: tenant.createdAt.toISOString(),
      };

      await this.idempotency.complete({
        tenantId: null,
        scope: PLATFORM_TENANT_CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });

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

      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: null,
        scope: PLATFORM_TENANT_CREATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async listTenants(identity: PlatformAdminIdentity, input: { limit: number; offset: number }): Promise<Tenant[]> {
    assertCapability(identity, "tenant.read");
    return this.tenants.list(input);
  }
}
