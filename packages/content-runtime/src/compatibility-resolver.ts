/**
 * Compatibility resolver (07_09 §21): "Il resolver verifica: platform
 * version; Web runtime version; engine version; adapter version; schema
 * version; theme bundle version; locale; capability; curriculum e content
 * edition; status e entitlement. Una combinazione incompatibile fallisce
 * prima dell'avvio." 07_09 gives only this checklist, no algorithm — this
 * implementation is the WEB-M2 design (see docs/adr/0003).
 *
 * Each check is independent and order-preserving in the result so a caller
 * can report every failing dimension at once, not just the first.
 */
export interface CompatibilityInput {
  platformVersion: string;
  webRuntimeVersion: string;
  requiredMinPlatformVersion?: string;
  requiredMinWebRuntimeVersion?: string;
  requiredMaxTestedWebRuntimeVersion?: string;
  schemaVersion: string;
  supportedSchemaVersions: string[];
  themeId?: string;
  availableThemeIds: string[];
  locale: string;
  supportedLocales: string[];
  requiredCapabilities: string[];
  availableCapabilities: string[];
  contentStatus: string;
  entitled: boolean;
}

export type CompatibilityFailureReason =
  | "PLATFORM_VERSION_TOO_LOW"
  | "WEB_RUNTIME_VERSION_TOO_LOW"
  | "WEB_RUNTIME_VERSION_UNTESTED"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "THEME_UNAVAILABLE"
  | "LOCALE_UNSUPPORTED"
  | "CAPABILITY_MISSING"
  | "CONTENT_NOT_PUBLISHED"
  | "NOT_ENTITLED";

export interface CompatibilityResult {
  compatible: boolean;
  failures: CompatibilityFailureReason[];
}

function semverAtLeast(actual: string, min: string): boolean {
  const a = actual.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

function semverAtMost(actual: string, max: string): boolean {
  return !semverAtLeast(actual, max) || actual === max;
}

export function resolveCompatibility(input: CompatibilityInput): CompatibilityResult {
  const failures: CompatibilityFailureReason[] = [];

  if (input.requiredMinPlatformVersion && !semverAtLeast(input.platformVersion, input.requiredMinPlatformVersion)) {
    failures.push("PLATFORM_VERSION_TOO_LOW");
  }
  if (
    input.requiredMinWebRuntimeVersion &&
    !semverAtLeast(input.webRuntimeVersion, input.requiredMinWebRuntimeVersion)
  ) {
    failures.push("WEB_RUNTIME_VERSION_TOO_LOW");
  }
  if (
    input.requiredMaxTestedWebRuntimeVersion &&
    !semverAtMost(input.webRuntimeVersion, input.requiredMaxTestedWebRuntimeVersion)
  ) {
    failures.push("WEB_RUNTIME_VERSION_UNTESTED");
  }
  if (!input.supportedSchemaVersions.includes(input.schemaVersion)) {
    failures.push("SCHEMA_VERSION_UNSUPPORTED");
  }
  if (input.themeId && !input.availableThemeIds.includes(input.themeId)) {
    failures.push("THEME_UNAVAILABLE");
  }
  if (!input.supportedLocales.includes(input.locale)) {
    failures.push("LOCALE_UNSUPPORTED");
  }
  const availableCapSet = new Set(input.availableCapabilities);
  if (input.requiredCapabilities.some((cap) => !availableCapSet.has(cap))) {
    failures.push("CAPABILITY_MISSING");
  }
  if (input.contentStatus !== "PUBLISHED") {
    failures.push("CONTENT_NOT_PUBLISHED");
  }
  if (!input.entitled) {
    failures.push("NOT_ENTITLED");
  }

  return { compatible: failures.length === 0, failures };
}
