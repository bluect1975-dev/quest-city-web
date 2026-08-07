import type { Queryable } from "./types";

export type SchoolClassStatus = "ACTIVE" | "ARCHIVED";

export interface SchoolClass {
  id: string;
  tenantId: string;
  publicId: string;
  name: string;
  status: SchoolClassStatus;
  createdAt: Date;
}

interface SchoolClassRow {
  id: string;
  tenant_id: string;
  public_id: string;
  name: string;
  status: SchoolClassStatus;
  created_at: Date;
}

function mapSchoolClass(row: SchoolClassRow): SchoolClass {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    publicId: row.public_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class SchoolClassRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<SchoolClass | null> {
    const result = await this.db.query<SchoolClassRow>(
      `SELECT id, tenant_id, public_id, name, status, created_at
       FROM school_class WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapSchoolClass(row) : null;
  }

  async findByPublicId(publicId: string): Promise<SchoolClass | null> {
    const result = await this.db.query<SchoolClassRow>(
      `SELECT id, tenant_id, public_id, name, status, created_at FROM school_class WHERE public_id = $1`,
      [publicId],
    );
    const [row] = result.rows;
    return row ? mapSchoolClass(row) : null;
  }

  /** WEB-M3B (02_35 §3.2, §5): SCHOOL_ADMIN's implicit tenant-wide class scope. */
  async findByTenant(tenantId: string): Promise<SchoolClass[]> {
    const result = await this.db.query<SchoolClassRow>(
      `SELECT id, tenant_id, public_id, name, status, created_at FROM school_class WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId],
    );
    return result.rows.map(mapSchoolClass);
  }

  /** WEB-M3B (02_35 §3.2, §5): TEACHER's explicit `staff_class_assignment`-scoped class list. */
  async findByIds(ids: string[], tenantId: string): Promise<SchoolClass[]> {
    if (ids.length === 0) return [];
    const result = await this.db.query<SchoolClassRow>(
      `SELECT id, tenant_id, public_id, name, status, created_at
       FROM school_class WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name ASC`,
      [tenantId, ids],
    );
    return result.rows.map(mapSchoolClass);
  }

  /** Administrative provisioning only (seed). */
  async create(input: {
    tenantId: string;
    publicId: string;
    name: string;
    status: SchoolClassStatus;
  }): Promise<SchoolClass> {
    const result = await this.db.query<SchoolClassRow>(
      `INSERT INTO school_class (tenant_id, public_id, name, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, public_id, name, status, created_at`,
      [input.tenantId, input.publicId, input.name, input.status],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapSchoolClass(row);
  }
}
