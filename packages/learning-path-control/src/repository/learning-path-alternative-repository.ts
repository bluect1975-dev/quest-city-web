import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";
import type { LearningPathResourceType } from "../resolver/resolve-effective-availability";

export interface LearningPathAlternative {
  id: string;
  publicId: string;
  tenantId: string;
  originalResourceType: LearningPathResourceType;
  originalResourceRef: string;
  alternativeContentRef: string;
  createdByStaffAccountId: string;
  createdAt: Date;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  original_resource_type: LearningPathResourceType;
  original_resource_ref: string;
  alternative_content_ref: string;
  created_by_staff_account_id: string;
  created_at: Date;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, original_resource_type, original_resource_ref, alternative_content_ref, created_by_staff_account_id, created_at`;

function mapRow(row: Row): LearningPathAlternative {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    originalResourceType: row.original_resource_type,
    originalResourceRef: row.original_resource_ref,
    alternativeContentRef: row.alternative_content_ref,
    createdByStaffAccountId: row.created_by_staff_account_id,
    createdAt: row.created_at,
  };
}

/** `learning_path_alternative` (02_41 §27, §42, migration 0013) -- ORIGINAL_CONTENT -> ALTERNATIVE_CONTENT mapping. Never mutates the original resource. */
export class LearningPathAlternativeRepository {
  constructor(private readonly db: Queryable) {}

  async findByPublicId(publicId: string, tenantId: string): Promise<LearningPathAlternative | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_path_alternative WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Used by the policy service to validate that an `alternativeContentRef` referenced by a `DISABLED_WITH_ALTERNATIVE` policy is a real, existing alternative mapping (LEARNING_PATH_ALTERNATIVE_INVALID otherwise). */
  async findByAlternativeContentRef(tenantId: string, alternativeContentRef: string): Promise<LearningPathAlternative | null> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM learning_path_alternative WHERE tenant_id = $1 AND alternative_content_ref = $2 LIMIT 1`,
      [tenantId, alternativeContentRef],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async create(input: {
    tenantId: string;
    originalResourceType: LearningPathResourceType;
    originalResourceRef: string;
    alternativeContentRef: string;
    createdByStaffAccountId: string;
  }): Promise<LearningPathAlternative> {
    const publicId = `lpa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO learning_path_alternative (public_id, tenant_id, original_resource_type, original_resource_ref, alternative_content_ref, created_by_staff_account_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [publicId, input.tenantId, input.originalResourceType, input.originalResourceRef, input.alternativeContentRef, input.createdByStaffAccountId],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
