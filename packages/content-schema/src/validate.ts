import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { schemas, type SchemaName } from "./schemas";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

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
