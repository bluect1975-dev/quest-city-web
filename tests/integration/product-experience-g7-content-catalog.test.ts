import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ContentBundleRepository } from "@quest-city-web/attempts";

/**
 * Pilot Product Experience Remediation, Tranche G7 (`UX-CONTENT-ASSIGNMENT-01`)
 * — `GET /content`'s underlying query (`ContentBundleRepository.findPublishedForWebRuntime`),
 * the catalog a teacher now picks from instead of typing a raw
 * `content_bundle.public_id`. Repository-level, matching the convention
 * that `apps/api/app/**` route handlers are thin composition over already-
 * tested repositories.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-g7-content-catalog
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query("TRUNCATE content_bundle_runtime_channel, content_bundle CASCADE");
}

async function createBundle(input: {
  subjectId: string;
  bundleType?: string;
  status: "DRAFT" | "PUBLISHED" | "DEPRECATED";
  runtimes: Array<"WEB" | "ROBLOX">;
  publishedAt?: string | null;
}): Promise<string> {
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, '1.0.0', $3, $4, $5, 's3://x', $6) RETURNING id`,
      [`bnd_${rnd()}`, input.subjectId, input.bundleType ?? "ACTIVITY_BUNDLE", input.status, `sha256:${rnd()}`, input.publishedAt ?? null],
    )
  ).rows[0]!.id;
  for (const channel of input.runtimes) {
    await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, $2)`, [id, channel]);
  }
  return id;
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("ContentBundleRepository.findPublishedForWebRuntime (GET /content teacher picker)", () => {
  beforeEach(truncateAll);

  it("returns only PUBLISHED bundles compatible with WEB — excludes DRAFT/DEPRECATED and Roblox-only", async () => {
    const published = await createBundle({ subjectId: "MAT", status: "PUBLISHED", runtimes: ["WEB"] });
    await createBundle({ subjectId: "MAT", status: "DRAFT", runtimes: ["WEB"] });
    await createBundle({ subjectId: "MAT", status: "DEPRECATED", runtimes: ["WEB"] });
    await createBundle({ subjectId: "MAT", status: "PUBLISHED", runtimes: ["ROBLOX"] });

    const repo = new ContentBundleRepository(pool);
    const results = await repo.findPublishedForWebRuntime();
    expect(results.map((r) => r.id)).toEqual([published]);
  });

  it("filters by subjectId when provided", async () => {
    const mat = await createBundle({ subjectId: "MAT", status: "PUBLISHED", runtimes: ["WEB"] });
    await createBundle({ subjectId: "ITA", status: "PUBLISHED", runtimes: ["WEB"] });

    const repo = new ContentBundleRepository(pool);
    const results = await repo.findPublishedForWebRuntime({ subjectId: "MAT" });
    expect(results.map((r) => r.id)).toEqual([mat]);
  });

  it("returns every published-WEB bundle across subjects when no filter is given", async () => {
    const mat = await createBundle({ subjectId: "MAT", status: "PUBLISHED", runtimes: ["WEB"] });
    const ita = await createBundle({ subjectId: "ITA", status: "PUBLISHED", runtimes: ["WEB"] });

    const repo = new ContentBundleRepository(pool);
    const results = await repo.findPublishedForWebRuntime();
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([mat, ita]));
  });

  it("never returns a duplicate row for a bundle compatible with both WEB and ROBLOX (JOIN does not fan out)", async () => {
    const bothRuntimes = await createBundle({ subjectId: "MAT", status: "PUBLISHED", runtimes: ["WEB", "ROBLOX"] });
    const repo = new ContentBundleRepository(pool);
    const results = await repo.findPublishedForWebRuntime();
    expect(results.map((r) => r.id)).toEqual([bothRuntimes]);
    expect(results[0]!.compatibleRuntimes.sort()).toEqual(["ROBLOX", "WEB"]);
  });
});
