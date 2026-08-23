import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ContentBundleRepository } from "@quest-city-web/attempts";

/**
 * Pilot Product Experience Residual Closure, Tranche H2 — closes
 * `NEW-GAP-CONTENT-BUNDLE-NO-TITLE-01`. Covers `ContentBundleRepository.
 * updateTitle` (the sanctioned write used by `tools/backfill-content-
 * bundle-titles.ts`) and confirms `findPublishedForWebRuntime`/`findByPublicId`
 * surface the real `title` (or `null`, never a fabricated fallback) that
 * `GET /content` serializes. Repository-level, same convention as
 * `product-experience-g7-content-catalog.test.ts`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-h2-content-title
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
  status?: "DRAFT" | "PUBLISHED" | "DEPRECATED";
  runtimes?: Array<"WEB" | "ROBLOX">;
}): Promise<{ id: string; publicId: string }> {
  const publicId = `bnd_${rnd()}`;
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, '1.0.0', 'ACTIVITY_BUNDLE', $3, $4, 's3://x', now()) RETURNING id`,
      [publicId, input.subjectId, input.status ?? "PUBLISHED", `sha256:${rnd()}`],
    )
  ).rows[0]!.id;
  for (const channel of input.runtimes ?? ["WEB"]) {
    await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, $2)`, [id, channel]);
  }
  return { id, publicId };
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("ContentBundleRepository.updateTitle / title surfacing (GET /content)", () => {
  beforeEach(truncateAll);

  it("is null until a title is backfilled — never a fabricated default", async () => {
    const { publicId } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    const bundle = await repo.findByPublicId(publicId);
    expect(bundle?.title).toBeNull();
  });

  it("updateTitle sets and persists a real title", async () => {
    const { publicId } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    const updated = await repo.updateTitle(publicId, "Riattiva la Balance Machine");
    expect(updated?.title).toBe("Riattiva la Balance Machine");
    const reread = await repo.findByPublicId(publicId);
    expect(reread?.title).toBe("Riattiva la Balance Machine");
  });

  it("updateTitle is idempotent — re-running with the same title changes nothing", async () => {
    const { publicId } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    await repo.updateTitle(publicId, "Riattiva la Balance Machine");
    const second = await repo.updateTitle(publicId, "Riattiva la Balance Machine");
    expect(second?.title).toBe("Riattiva la Balance Machine");
  });

  it("updateTitle returns null for an unknown public_id (backfill script logs a skip, never throws)", async () => {
    const repo = new ContentBundleRepository(pool);
    expect(await repo.updateTitle("bnd_does_not_exist", "Some Title")).toBeNull();
  });

  it("never sets a different bundle's title", async () => {
    const { publicId: a } = await createBundle({ subjectId: "MAT" });
    const { publicId: b } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    await repo.updateTitle(a, "Bundle A Title");
    const bundleB = await repo.findByPublicId(b);
    expect(bundleB?.title).toBeNull();
  });

  it("findPublishedForWebRuntime (GET /content catalog) surfaces the real title alongside a null one, mixed", async () => {
    const { publicId: titled } = await createBundle({ subjectId: "MAT" });
    const { publicId: untitled } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    await repo.updateTitle(titled, "Domande rapide");
    const catalog = await repo.findPublishedForWebRuntime({ subjectId: "MAT" });
    const titledEntry = catalog.find((b) => b.publicId === titled);
    const untitledEntry = catalog.find((b) => b.publicId === untitled);
    expect(titledEntry?.title).toBe("Domande rapide");
    expect(untitledEntry?.title).toBeNull();
  });

  it("rejects a title longer than 200 characters at the DB constraint layer", async () => {
    const { publicId } = await createBundle({ subjectId: "MAT" });
    const repo = new ContentBundleRepository(pool);
    await expect(repo.updateTitle(publicId, "x".repeat(201))).rejects.toThrow();
  });
});
