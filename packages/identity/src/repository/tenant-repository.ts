import type { Queryable } from "./types";

export type TenantType = "SCHOOL" | "ORGANIZATION";
export type TenantStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface Tenant {
  id: string;
  publicId: string;
  type: TenantType;
  status: TenantStatus;
  name: string;
  settingsJson: Record<string, unknown>;
  createdAt: Date;
}

interface TenantRow {
  id: string;
  public_id: string;
  type: TenantType;
  status: TenantStatus;
  name: string;
  settings_json: Record<string, unknown>;
  created_at: Date;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    publicId: row.public_id,
    type: row.type,
    status: row.status,
    name: row.name,
    settingsJson: row.settings_json,
    createdAt: row.created_at,
  };
}

export class TenantRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.db.query<TenantRow>(
      `SELECT id, public_id, type, status, name, settings_json, created_at FROM tenant WHERE id = $1`,
      [id],
    );
    const [row] = result.rows;
    return row ? mapTenant(row) : null;
  }

  async findByPublicId(publicId: string): Promise<Tenant | null> {
    const result = await this.db.query<TenantRow>(
      `SELECT id, public_id, type, status, name, settings_json, created_at FROM tenant WHERE public_id = $1`,
      [publicId],
    );
    const [row] = result.rows;
    return row ? mapTenant(row) : null;
  }

  /** Administrative provisioning only (seed) — no public endpoint calls this. */
  async create(input: {
    publicId: string;
    type: TenantType;
    status: TenantStatus;
    name: string;
    settingsJson?: Record<string, unknown>;
  }): Promise<Tenant> {
    const result = await this.db.query<TenantRow>(
      `INSERT INTO tenant (public_id, type, status, name, settings_json)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, public_id, type, status, name, settings_json, created_at`,
      [input.publicId, input.type, input.status, input.name, JSON.stringify(input.settingsJson ?? {})],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapTenant(row);
  }
}
