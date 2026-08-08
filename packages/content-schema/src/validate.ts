import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { schemas, type SchemaName } from "./schemas";

const ajv = new Ajv2020({
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
addFormats(ajv);

/**
 * The vendored R3A schemas (packages/content-schema/schemas/vendor/r3a/,
 * provenance in that directory) declare a top-level `schemaVersion`
 * annotation alongside `$id`/`title` — plain documentation metadata, not a
 * validation keyword. Ajv's strict mode otherwise rejects any keyword it
 * does not recognize. Registering it as a no-op keyword is a Web-side AJV
 * adapter accommodation, not a fork of the vendored schema content (R3B
 * §12): the schema files under vendor/r3a/ are never edited locally.
 */
ajv.addKeyword({ keyword: "schemaVersion" });

for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(schema, name);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainst(schemaName: SchemaName, data: unknown): ValidationResult {
  const validateFn = ajv.getSchema(schemaName);
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
