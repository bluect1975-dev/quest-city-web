import { validateAgainst } from "@quest-city-web/content-schema";

/**
 * Loads and validates a content bundle manifest before anything downstream
 * may execute it (07_05 §9: "Il bundle viene validato prima dell'esecuzione.
 * Una versione incompatibile produce errore controllato").
 *
 * WEB-M0 scope: this only validates the manifest shape. It does not fetch
 * from a real publish pipeline (no such pipeline exists yet — ADR-0005 §10
 * defers the registry/publish-channel decision) and does not resolve
 * engines, themes or assets.
 */
export interface BundleLoadResult {
  ok: boolean;
  errors: string[];
}

export function loadBundleManifest(manifest: unknown): BundleLoadResult {
  const result = validateAgainst("webContentBundleManifest", manifest);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  const bundleType = (manifest as { bundleType?: string }).bundleType;
  if (bundleType !== "RUNTIME_FIXTURE_BUNDLE") {
    return {
      ok: false,
      errors: [
        `bundleType '${String(bundleType)}' is not servable at WEB-M0 — only RUNTIME_FIXTURE_BUNDLE is supported until a real content pipeline exists.`,
      ],
    };
  }
  return { ok: true, errors: [] };
}
