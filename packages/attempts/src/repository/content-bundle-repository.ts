import type { Queryable } from "./types";

export type ContentBundleStatus = "DRAFT" | "PUBLISHED" | "DEPRECATED";
export type ContentBundleType =
  | "COURSE_CATALOG_BUNDLE"
  | "LESSON_BUNDLE"
  | "ACTIVITY_BUNDLE"
  | "THEME_BUNDLE"
  | "ASSET_BUNDLE"
  | "LOCALIZATION_BUNDLE"
  | "RUNTIME_FIXTURE_BUNDLE";

export interface ContentBundle {
  id: string;
  publicId: string;
  subjectId: string;
  bundleVersion: string;
  bundleType: ContentBundleType;
  status: ContentBundleStatus;
  manifestHash: string;
  storageRef: string;
  publishedAt: Date | null;
  createdAt: Date;
  compatibleRuntimes: Array<"WEB" | "ROBLOX">;
  /** Pilot Product Experience Residual Closure (Tranche H2, migration 0018): real, source-cited human title. `null` for a bundle no canonical title has been traced for yet — never a fabricated value. */
  title: string | null;
}

interface ContentBundleRow {
  id: string;
  public_id: string;
  subject_id: string;
  bundle_version: string;
  bundle_type: ContentBundleType;
  status: ContentBundleStatus;
  manifest_hash: string;
  storage_ref: string;
  published_at: Date | null;
  created_at: Date;
  title: string | null;
}

const SELECT_COLUMNS = `id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at, created_at, title`;

function mapRow(row: ContentBundleRow, runtimeChannels: Array<"WEB" | "ROBLOX">): ContentBundle {
  return {
    id: row.id,
    publicId: row.public_id,
    subjectId: row.subject_id,
    bundleVersion: row.bundle_version,
    bundleType: row.bundle_type,
    status: row.status,
    manifestHash: row.manifest_hash,
    storageRef: row.storage_ref,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    compatibleRuntimes: runtimeChannels,
    title: row.title,
  };
}

export class ContentBundleRepository {
  constructor(private readonly db: Queryable) {}

  private async runtimeChannelsFor(contentBundleId: string): Promise<Array<"WEB" | "ROBLOX">> {
    const result = await this.db.query<{ runtime_channel: "WEB" | "ROBLOX" }>(
      `SELECT runtime_channel FROM content_bundle_runtime_channel WHERE content_bundle_id = $1`,
      [contentBundleId],
    );
    return result.rows.map((r) => r.runtime_channel);
  }

  async findById(id: string): Promise<ContentBundle | null> {
    const result = await this.db.query<ContentBundleRow>(`SELECT ${SELECT_COLUMNS} FROM content_bundle WHERE id = $1`, [
      id,
    ]);
    const [row] = result.rows;
    if (!row) return null;
    return mapRow(row, await this.runtimeChannelsFor(row.id));
  }

  /**
   * `GET /content` (Pilot Product Experience Remediation Tranche G7,
   * `UX-CONTENT-ASSIGNMENT-01`) — the content catalog a teacher picks from
   * instead of typing a raw `public_id`. `content_bundle` is GLOBAL, not
   * tenant-scoped (see the table's own doc comment), so this never takes a
   * `tenantId` — every PUBLISHED, WEB-compatible bundle is visible to
   * every authenticated staff member, same scope the raw-ID text field
   * already implicitly allowed (any staff member who knew an ID could
   * assign it). `subjectId` filters on the exact stored code (e.g. `MAT`)
   * — there is no `subject_catalogue` lookup table in this schema yet, so
   * the raw code (not a human-readable subject name) is still what a
   * filter/display groups by; `title` (Tranche H2, closes
   * `NEW-GAP-CONTENT-BUNDLE-NO-TITLE-01`) is a real, source-cited human
   * title, `null` when no canonical title has been traced for a bundle.
   */
  async findPublishedForWebRuntime(filters: { subjectId?: string } = {}): Promise<ContentBundle[]> {
    const conditions = [`cb.status = 'PUBLISHED'`, `crc.runtime_channel = 'WEB'`];
    const values: string[] = [];
    if (filters.subjectId) {
      values.push(filters.subjectId);
      conditions.push(`cb.subject_id = $${values.length}`);
    }
    const result = await this.db.query<ContentBundleRow>(
      `SELECT DISTINCT ${SELECT_COLUMNS.split(", ").map((c) => `cb.${c}`).join(", ")}
       FROM content_bundle cb
       JOIN content_bundle_runtime_channel crc ON crc.content_bundle_id = cb.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cb.subject_id ASC, cb.bundle_type ASC, cb.published_at DESC NULLS LAST`,
      values,
    );
    return Promise.all(result.rows.map(async (row) => mapRow(row, await this.runtimeChannelsFor(row.id))));
  }

  /** Public-format identifier lookup (`bnd_...`) — for any caller (e.g. a staff-facing form) that only knows the content bundle's public id, never its internal uuid. */
  async findByPublicId(publicId: string): Promise<ContentBundle | null> {
    const result = await this.db.query<ContentBundleRow>(
      `SELECT ${SELECT_COLUMNS} FROM content_bundle WHERE public_id = $1`,
      [publicId],
    );
    const [row] = result.rows;
    if (!row) return null;
    return mapRow(row, await this.runtimeChannelsFor(row.id));
  }

  /** Administrative/seed provisioning only — no public write endpoint exists. */
  async create(input: {
    publicId: string;
    subjectId: string;
    bundleVersion: string;
    bundleType: ContentBundleType;
    status: ContentBundleStatus;
    manifestHash: string;
    storageRef: string;
    publishedAt?: Date | null;
    compatibleRuntimes: Array<"WEB" | "ROBLOX">;
  }): Promise<ContentBundle> {
    const result = await this.db.query<ContentBundleRow>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.publicId,
        input.subjectId,
        input.bundleVersion,
        input.bundleType,
        input.status,
        input.manifestHash,
        input.storageRef,
        input.publishedAt ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    for (const channel of input.compatibleRuntimes) {
      await this.db.query(
        `INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, $2)`,
        [row.id, channel],
      );
    }
    return mapRow(row, input.compatibleRuntimes);
  }

  /**
   * Administrative/backfill provisioning only (`tools/backfill-content-
   * bundle-titles.ts`, Tranche H2) — no public write endpoint exists,
   * same convention as `create`. The sanctioned surface for setting a
   * bundle's title, so operators never write `content_bundle.title`
   * directly via raw SQL.
   */
  async updateTitle(publicId: string, title: string): Promise<ContentBundle | null> {
    const result = await this.db.query<ContentBundleRow>(
      `UPDATE content_bundle SET title = $2 WHERE public_id = $1 RETURNING ${SELECT_COLUMNS}`,
      [publicId, title],
    );
    const [row] = result.rows;
    if (!row) return null;
    return mapRow(row, await this.runtimeChannelsFor(row.id));
  }
}
