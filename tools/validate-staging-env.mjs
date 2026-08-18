#!/usr/bin/env node
// Quest City Web — staging fail-fast environment guard (Tranche E mission
// §6; design report §57). Run as the `staging-guard` compose service
// (docker-compose.staging.yml), which `api` depends on via
// `condition: service_completed_successfully` — if this script exits
// non-zero, Compose never starts `api` at all. This is a genuine
// orchestration-level gate, not an in-process check that could be bypassed
// by starting the container directly.
//
// No-op unless STAGING_ENV_STRICT=true — local dev and CI never set that
// variable, so this script has zero effect on either (mission §6: "Do not
// weaken existing local-development behavior unnecessarily").
//
// Checks exactly the minimum list the mission specifies (§6): DATABASE_SSL,
// the insecure session-cookie override, CLASS_CODE_HASH_PEPPER strength,
// default/changeme credentials, required CSRF origins, and domain
// configuration. Anything beyond that minimum is a warning, not a blocker.

import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MARKERS = ["changeme_local_only", "changeme", "REPLACE_WITH"];

/**
 * Pure validation function — takes an env-like object, returns
 * `{ failures, warnings, skipped }`. `skipped` is true when
 * STAGING_ENV_STRICT !== "true" (the no-op case). Exported for unit testing
 * (validate-staging-env.test.mjs); the CLI wrapper below is the only part
 * that touches process.exit.
 */
export function validateStagingEnv(env) {
  if (env.STAGING_ENV_STRICT !== "true") {
    return { failures: [], warnings: [], skipped: true };
  }

  const failures = [];
  const warnings = [];

  // 1. DATABASE_SSL must be exactly "true" (ACN/MePA Gap Analysis GAP-09).
  if (env.DATABASE_SSL !== "true") {
    failures.push(`DATABASE_SSL must be exactly "true" in staging, got: ${JSON.stringify(env.DATABASE_SSL ?? null)}`);
  }

  // 2. Insecure session-cookie override must never be active in staging.
  //    The application code itself already refuses this outside
  //    NODE_ENV=development (apps/api/lib/env.ts) — this is a second,
  //    independent line of defense at the orchestration level.
  if (env.SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL === "true") {
    failures.push("SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL must not be 'true' in staging.");
  }

  // 3. CLASS_CODE_HASH_PEPPER must be present and decode to >= 32 bytes.
  //    Mirrors apps/api/lib/env.ts's own validation (decodeClassCodePepper)
  //    so a misconfigured staging environment is caught before any
  //    container that depends on it even starts.
  const pepperRaw = env.CLASS_CODE_HASH_PEPPER;
  if (!pepperRaw) {
    failures.push("CLASS_CODE_HASH_PEPPER is required and has no default — see .env.staging.example.");
  } else {
    try {
      const decoded = Buffer.from(pepperRaw, "base64");
      if (decoded.length < 32) {
        failures.push(`CLASS_CODE_HASH_PEPPER must decode to at least 32 bytes, got ${decoded.length}.`);
      }
    } catch {
      failures.push("CLASS_CODE_HASH_PEPPER is not valid base64.");
    }
  }

  // 4. No default/changeme credentials.
  for (const key of ["DATABASE_URL", "WEB_AUTH_TRUSTED_ORIGINS", "STAFF_AUTH_TRUSTED_ORIGINS", "PLATFORM_AUTH_TRUSTED_ORIGINS"]) {
    const value = env[key] ?? "";
    const hit = DEFAULT_MARKERS.find((marker) => value.includes(marker));
    if (hit) {
      failures.push(`${key} still contains the placeholder/default marker "${hit}" — replace it with a real staging value.`);
    }
  }

  // 5. Required CSRF origins must be present, https, and not localhost.
  for (const key of ["WEB_AUTH_TRUSTED_ORIGINS", "STAFF_AUTH_TRUSTED_ORIGINS", "PLATFORM_AUTH_TRUSTED_ORIGINS"]) {
    const value = env[key];
    if (!value || value.trim().length === 0) {
      failures.push(`${key} is required in staging (no CSRF-trusted origin configured).`);
      continue;
    }
    if (value.includes("localhost") || value.includes("127.0.0.1")) {
      failures.push(`${key} must not reference localhost/127.0.0.1 in staging, got: ${value}`);
    }
    if (!value.startsWith("https://")) {
      failures.push(`${key} must be an https:// origin in staging, got: ${value}`);
    }
  }

  // 6. Domain configuration.
  for (const key of ["NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL_DASHBOARD"]) {
    const value = env[key];
    if (!value || value.trim().length === 0) {
      failures.push(`${key} is required in staging (no domain configured).`);
    } else if (value.includes("REPLACE_WITH_STAGING_DOMAIN") || value.includes("localhost")) {
      failures.push(`${key} still points at a placeholder/local domain, got: ${value}`);
    }
  }

  // Advisory-only checks (not part of the mission's minimum list) — never
  // fail the gate.
  if (!env.BACKUP_ENCRYPTION_KEY) {
    warnings.push("BACKUP_ENCRYPTION_KEY is not set — backups will fail to encrypt until it is configured.");
  }
  if (!env.STAGING_ALERT_WEBHOOK_URL) {
    warnings.push("STAGING_ALERT_WEBHOOK_URL is not set — staging-healthcheck.mjs will log-only, no external alert delivery.");
  }

  return { failures, warnings, skipped: false };
}

async function main() {
  const { failures, warnings, skipped } = validateStagingEnv(process.env);

  if (skipped) {
    console.log("STAGING_ENV_STRICT is not 'true' — staging guard is a no-op (expected for local dev and CI).");
    return;
  }

  for (const warning of warnings) {
    console.warn(`WARNING: ${warning}`);
  }

  if (failures.length > 0) {
    console.error("Staging environment guard FAILED — refusing to start the stack:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Staging environment guard PASSED.");
}

// Only run as CLI when invoked directly (`node validate-staging-env.mjs`),
// not when imported by the test file.
// Cross-platform entrypoint check -- comparing import.meta.url against
// a raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run
// when this script is invoked directly with plain `node script.mjs`.
// Resolving both sides to real filesystem paths is safe on every platform.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
