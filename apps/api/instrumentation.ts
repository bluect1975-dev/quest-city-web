/**
 * Next.js instrumentation hook (stable since Next.js 15): `register()` runs
 * once, before any request is served, in the Node.js runtime. Used here to
 * make environment validation (`lib/env.ts#loadEnv`) a true startup check
 * rather than something that only fails on the first request that happens
 * to touch it — this is what makes "startup fails if CLASS_CODE_HASH_PEPPER
 * is missing or too short" (WEB-M1 Fase 2 correction #1) actually true at
 * process boot, in every environment, not just in production/staging.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEnv } = await import("./lib/env");
    loadEnv();
  }
}
