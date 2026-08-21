import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { schemas, type SchemaName } from "./schemas";

// Constructing an Ajv instance (not merely importing the constructor)
// compiles its built-in meta-schemas via `new Function(...)` — a browser
// enforcing `script-src` without `unsafe-eval` (this repo's real CSP,
// `infrastructure/reverse-proxy/nginx*.conf`) throws `EvalError` the
// instant that construction runs. Every real caller of `validateAgainst`
// is server-side only (apps/api route handlers, packages/attempts,
// content-runtime's server-invoked bundle/attempt-context loaders —
// verified by a repo-wide grep, Tranche F pilot hardening finding): no
// `student-web` component calls it directly. The problem was never the
// feature, it was that this module is transitively bundled into the
// client through `@quest-city-web/content-runtime`'s single barrel
// export, and the previous top-level `new Ajv2020(...)` ran unconditionally
// at import time regardless of whether the client ever calls it. The
// `import` of the constructor itself is inert (safe in a browser bundle);
// deferring the actual `new Ajv2020(...)`/`addSchema` construction to
// first real call means the client bundle can still contain this code
// without ever executing it, since no client code path reaches
// `validateAgainst`.
let ajv: Ajv2020 | undefined;

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  const instance = new Ajv2020({
    allErrors: true,
    strict: true,
    // The vendored R3A support-evaluation schema (vendor/r3a/support-evaluation.schema.json)
    // uses `if`/`then` blocks whose `required` refers to a property declared
    // in the schema's own top-level `properties`, not repeated inside the
    // `then` branch — valid JSON Schema, but Ajv's `strictRequired` heuristic
    // cannot verify it without that repetition and refuses to compile.
    // Disabling only this granular strict check is a Web-side Ajv adapter
    // accommodation; the vendored schema itself is never edited (R3B §12).
    strictRequired: false,
  });
  addFormats(instance);

  /**
   * The vendored R3A schemas (packages/content-schema/schemas/vendor/r3a/,
   * provenance in that directory) declare a top-level `schemaVersion`
   * annotation alongside `$id`/`title` — plain documentation metadata, not a
   * validation keyword. Ajv's strict mode otherwise rejects any keyword it
   * does not recognize. Registering it as a no-op keyword is a Web-side AJV
   * adapter accommodation, not a fork of the vendored schema content (R3B
   * §12): the schema files under vendor/r3a/ are never edited locally.
   */
  instance.addKeyword({ keyword: "schemaVersion" });

  for (const [name, schema] of Object.entries(schemas)) {
    instance.addSchema(schema, name);
  }

  ajv = instance;
  return instance;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainst(schemaName: SchemaName, data: unknown): ValidationResult {
  const validateFn = getAjv().getSchema(schemaName);
  if (!validateFn) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }
  const valid = validateFn(data) as boolean;
  return {
    valid,
    errors: (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    ),
  };
}
