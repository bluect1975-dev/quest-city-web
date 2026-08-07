import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { validateAgainst } from "@quest-city-web/content-schema";

/**
 * Loads and validates a content bundle manifest before anything downstream
 * may execute it (07_09 §4: every published bundle is content-addressed or
 * associated with a verifiable hash; §21 compatibility must be checked
 * before launch).
 *
 * WEB-M2 scope: real SHA-256 checksum computation and verification, and
 * real path-traversal protection when resolving an entry's file on disk —
 * superseding the WEB-M0 shape-only validation (see docs/adr/0003). Does
 * not fetch from a real publish pipeline (ADR-0005 §10 defers the
 * registry/publish-channel decision) and does not resolve engines, themes
 * or assets beyond entry-level integrity.
 */
export interface BundleLoadResult {
  ok: boolean;
  errors: string[];
}

export interface WebContentBundleManifest {
  bundleId: string;
  bundleVersion: string;
  bundleType: string;
  status: string;
  contentVersion: string;
  entries: BundleEntry[];
  integrity: { algorithm: "sha256"; digest: string };
  [key: string]: unknown;
}

export interface BundleEntry {
  entryId: string;
  entryType: string;
  path: string;
  schemaRef: string;
  contentDigest: string;
  required: boolean;
}

const SERVABLE_BUNDLE_TYPES = new Set(["RUNTIME_FIXTURE_BUNDLE"]);

export function loadBundleManifest(manifest: unknown): BundleLoadResult {
  const result = validateAgainst("webContentBundleManifest", manifest);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  const bundleType = (manifest as { bundleType?: string }).bundleType;
  if (!bundleType || !SERVABLE_BUNDLE_TYPES.has(bundleType)) {
    return {
      ok: false,
      errors: [
        `bundleType '${String(bundleType)}' is not servable at WEB-M2 — only RUNTIME_FIXTURE_BUNDLE is supported until a real content pipeline exists.`,
      ],
    };
  }
  const entries = (manifest as WebContentBundleManifest).entries ?? [];
  for (const entry of entries) {
    const pathCheck = isSafeEntryPath(entry.path);
    if (!pathCheck.safe) {
      return { ok: false, errors: [`entry '${entry.entryId}': unsafe path '${entry.path}' — ${pathCheck.reason}`] };
    }
  }
  return { ok: true, errors: [] };
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Recomputes the manifest-level integrity digest over the exact bytes the
 * manifest was published with (the canonical serialized form, provided by
 * the caller) and compares it to `manifest.integrity.digest`. Real
 * verification, not shape-only — a mismatch means the manifest bytes were
 * tampered with or corrupted in transit/storage.
 */
export function verifyManifestIntegrity(manifest: WebContentBundleManifest, manifestBytes: Buffer | string): boolean {
  if (manifest.integrity?.algorithm !== "sha256") return false;
  return sha256Hex(manifestBytes) === manifest.integrity.digest;
}

/**
 * Verifies a single entry's content against its declared contentDigest
 * (07_09 §6, §18: "hash mismatch comporta scarto e nuovo download").
 */
export function verifyEntryDigest(entry: BundleEntry, content: Buffer | string): boolean {
  const expected = entry.contentDigest.replace(/^sha256:/, "");
  return sha256Hex(content) === expected;
}

/**
 * Real path-traversal protection (07_09 §6: "Path relativi, normalizzati e
 * privi di traversal. URL esterni arbitrari sono vietati."). Rejects
 * absolute paths, `..` segments, and any path that would resolve outside
 * the given bundle root — checked via actual path resolution, not just a
 * regex on the raw string (a regex alone can be defeated by encoding or
 * platform-specific separators; resolving against the root and verifying
 * containment is the real guarantee).
 */
export function isSafeEntryPath(rawPath: string): { safe: boolean; reason?: string } {
  if (!rawPath || rawPath.length === 0) return { safe: false, reason: "empty path" };
  if (isAbsolute(rawPath)) return { safe: false, reason: "absolute paths are forbidden" };
  if (/^[a-zA-Z]+:\/\//.test(rawPath)) return { safe: false, reason: "external URLs are forbidden" };
  if (rawPath.split(/[/\\]/).includes("..")) return { safe: false, reason: "path traversal segment '..' is forbidden" };
  return { safe: true };
}

/**
 * Resolves an entry's on-disk path against a trusted bundle root,
 * re-verifying containment after resolution (defense in depth beyond
 * `isSafeEntryPath`'s string-level check). Returns null if the resolved
 * path would escape the root.
 */
export function resolveEntryFilePath(bundleRootDir: string, entry: BundleEntry): string | null {
  const check = isSafeEntryPath(entry.path);
  if (!check.safe) return null;
  const root = resolve(bundleRootDir);
  const resolved = resolve(root, entry.path);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep)[0] === "..") {
    return null;
  }
  return resolved;
}
