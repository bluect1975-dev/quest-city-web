import type { Pool } from "pg";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { LearningPathAlternativeRepository, type LearningPathAlternative } from "../repository/learning-path-alternative-repository";
import type { LearningPathResourceType } from "../resolver/resolve-effective-availability";

const IDEMPOTENCY_SCOPE = "learning_path_alternative_create";

/**
 * `POST /learning-path-alternatives` (02_41 §27, §34). Capability
 * `learning_path.alternative.assign`. Does not itself validate that
 * `alternativeContentRef` is a published/authorized resource -- that
 * validation is asset-registry-specific and out of this Web
 * implementation's scope (ILE runtime is NOT_STARTED, mission §66); this
 * service records the mapping and provenance only, exactly as 02_41 §27
 * describes ("mai una mutazione dell'originale").
 */
export class LearningPathAlternativeService {
  private readonly alternatives: LearningPathAlternativeRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.alternatives = new LearningPathAlternativeRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    originalResourceType: LearningPathResourceType;
    originalResourceRef: string;
    alternativeContentRef: string;
    idempotencyKey: string;
  }): Promise<LearningPathAlternative> {
    const { identity } = input;
    assertStaffCapability(identity, "learning_path.alternative.assign");

    if (input.originalResourceRef === input.alternativeContentRef) {
      throw new StaffIdentityError("VALIDATION_ERROR", "alternativeContentRef must reference a different resource than the original.");
    }

    const scopeKey = input.idempotencyKey;
    const requestHash = JSON.stringify({
      originalResourceType: input.originalResourceType,
      originalResourceRef: input.originalResourceRef,
      alternativeContentRef: input.alternativeContentRef,
    });
    const begin = await this.idempotency.begin({ tenantId: identity.tenantId, scope: IDEMPOTENCY_SCOPE, scopeKey, requestHash });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as LearningPathAlternative;
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
      const created = await this.alternatives.create({
        tenantId: identity.tenantId,
        originalResourceType: input.originalResourceType,
        originalResourceRef: input.originalResourceRef,
        alternativeContentRef: input.alternativeContentRef,
        createdByStaffAccountId: identity.staffAccountId,
      });

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });

      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "learning_path.alternative_assigned",
        targetType: "learning_path_alternative",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { originalResourceType: input.originalResourceType },
      });

      return created;
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
}
