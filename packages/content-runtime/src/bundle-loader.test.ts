import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  loadBundleManifest,
  verifyManifestIntegrity,
  verifyEntryDigest,
  isSafeEntryPath,
  resolveEntryFilePath,
  type WebContentBundleManifest,
} from "./bundle-loader";

function makeManifest(overrides: Partial<WebContentBundleManifest> = {}): WebContentBundleManifest {
  return {
    bundleSchemaVersion: "1.0.0",
    bundleId: "fixture-balance-machine-v1",
    bundleVersion: "1.0.0",
    bundleType: "RUNTIME_FIXTURE_BUNDLE",
    status: "PUBLISHED",
    contentVersion: "0.0.1-fixture",
    publishedAt: "2026-08-05T00:00:00.000Z",
    compatibleRuntimes: ["WEB"],
    entries: [
      {
        entryId: "MAT-M06-BALANCE-001",
        entryType: "activity",
        path: "activities/MAT-M06-BALANCE-001.json",
        schemaRef: "qc://schemas/activity-definition/1.0.0",
        contentDigest: "sha256:" + "a".repeat(64),
        required: true,
      },
    ],
    integrity: { algorithm: "sha256", digest: "b".repeat(64) },
    ...overrides,
  } as WebContentBundleManifest;
}

describe("loadBundleManifest", () => {
  it("accepts a well-formed RUNTIME_FIXTURE_BUNDLE manifest", () => {
    const result = loadBundleManifest(makeManifest());
    expect(result.ok).toBe(true);
  });

  it("rejects a bundle type other than RUNTIME_FIXTURE_BUNDLE at WEB-M2", () => {
    const result = loadBundleManifest(makeManifest({ bundleType: "LESSON_BUNDLE" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a structurally invalid manifest", () => {
    const result = loadBundleManifest({ bundleId: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a manifest whose entry has a path-traversal path", () => {
    const result = loadBundleManifest(
      makeManifest({
        entries: [
          {
            entryId: "evil",
            entryType: "activity",
            path: "../../etc/passwd",
            schemaRef: "qc://schemas/activity-definition/1.0.0",
            contentDigest: "sha256:" + "a".repeat(64),
            required: true,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    // Rejected either by the schema's own path pattern (checked first, as
    // part of manifest-shape validation) or by isSafeEntryPath's runtime
    // check below it — either layer rejecting is correct; this only
    // asserts that the entry never gets a green light.
    expect(result.errors[0]).toMatch(/path/i);
  });
});

describe("verifyManifestIntegrity (real SHA-256)", () => {
  it("accepts when the digest matches the actual manifest bytes", () => {
    const bytes = Buffer.from(JSON.stringify({ a: 1 }));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const manifest = makeManifest({ integrity: { algorithm: "sha256", digest } });
    expect(verifyManifestIntegrity(manifest, bytes)).toBe(true);
  });

  it("rejects when the digest does not match (tampered/corrupted bytes)", () => {
    const bytes = Buffer.from(JSON.stringify({ a: 1 }));
    const manifest = makeManifest({ integrity: { algorithm: "sha256", digest: "c".repeat(64) } });
    expect(verifyManifestIntegrity(manifest, bytes)).toBe(false);
    const tamperedBytes = Buffer.from(JSON.stringify({ a: 2 }));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const manifest2 = makeManifest({ integrity: { algorithm: "sha256", digest } });
    expect(verifyManifestIntegrity(manifest2, tamperedBytes)).toBe(false);
  });
});

describe("verifyEntryDigest (real SHA-256)", () => {
  it("accepts when the entry content matches its declared contentDigest", () => {
    const content = "hello world";
    const digest = createHash("sha256").update(content).digest("hex");
    const entry = {
      entryId: "e1",
      entryType: "activity",
      path: "a.json",
      schemaRef: "qc://schemas/x/1.0.0",
      contentDigest: `sha256:${digest}`,
      required: true,
    };
    expect(verifyEntryDigest(entry, content)).toBe(true);
  });

  it("rejects when the content does not match", () => {
    const entry = {
      entryId: "e1",
      entryType: "activity",
      path: "a.json",
      schemaRef: "qc://schemas/x/1.0.0",
      contentDigest: `sha256:${"a".repeat(64)}`,
      required: true,
    };
    expect(verifyEntryDigest(entry, "different content")).toBe(false);
  });
});

describe("isSafeEntryPath / resolveEntryFilePath (real path-traversal protection)", () => {
  it("accepts a normal relative path", () => {
    expect(isSafeEntryPath("activities/foo.json").safe).toBe(true);
  });

  it("rejects an absolute path", () => {
    expect(isSafeEntryPath("/etc/passwd").safe).toBe(false);
  });

  it("rejects a path with a .. traversal segment", () => {
    expect(isSafeEntryPath("../../etc/passwd").safe).toBe(false);
    expect(isSafeEntryPath("activities/../../etc/passwd").safe).toBe(false);
  });

  it("rejects an external URL", () => {
    expect(isSafeEntryPath("https://evil.example/x").safe).toBe(false);
  });

  it("resolveEntryFilePath keeps a normal entry within the bundle root", () => {
    const root = process.cwd();
    const resolved = resolveEntryFilePath(root, {
      entryId: "e1",
      entryType: "activity",
      path: "activities/foo.json",
      schemaRef: "qc://schemas/x/1.0.0",
      contentDigest: `sha256:${"a".repeat(64)}`,
      required: true,
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(root)).toBe(true);
  });

  it("resolveEntryFilePath returns null for a traversal attempt", () => {
    const root = process.cwd();
    const resolved = resolveEntryFilePath(root, {
      entryId: "evil",
      entryType: "activity",
      path: "../../../etc/passwd",
      schemaRef: "qc://schemas/x/1.0.0",
      contentDigest: `sha256:${"a".repeat(64)}`,
      required: true,
    });
    expect(resolved).toBeNull();
  });
});
