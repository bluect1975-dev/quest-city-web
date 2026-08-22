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
}

const SELECT_COLUMNS = `id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at, created_at`;

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
}
