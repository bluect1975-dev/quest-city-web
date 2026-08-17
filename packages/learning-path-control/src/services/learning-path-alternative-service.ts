import type { Pool } from "pg";
import { StaffIdentityError, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { AuditRepository } from "@quest-city-web/identity";
import { LearningPathAlternativeRepository, type LearningPathAlternative } from "../repository/learning-path-alternative-repository";
import type { LearningPathResourceType } from "../resolver/resolve-effective-availability";

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
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.alternatives = new LearningPathAlternativeRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    originalResourceType: LearningPathResourceType;
    originalResourceRef: string;
    alternativeContentRef: string;
  }): Promise<LearningPathAlternative> {
    const { identity } = input;
    assertStaffCapability(identity, "learning_path.alternative.assign");

    if (input.originalResourceRef === input.alternativeContentRef) {
      throw new StaffIdentityError("VALIDATION_ERROR", "alternativeContentRef must reference a different resource than the original.");
    }

    const created = await this.alternatives.create({
      tenantId: identity.tenantId,
      originalResourceType: input.originalResourceType,
      originalResourceRef: input.originalResourceRef,
      alternativeContentRef: input.alternativeContentRef,
      createdByStaffAccountId: identity.staffAccountId,
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
  }
}
