import webContentBundleManifest from "../schemas/web-content-bundle-manifest.schema.json" with { type: "json" };
import activityDefinition from "../schemas/activity-definition.schema.json" with { type: "json" };
import presentationAdapter from "../schemas/presentation-adapter.schema.json" with { type: "json" };
import capabilityProfile from "../schemas/capability-profile.schema.json" with { type: "json" };
import semanticAction from "../schemas/semantic-action.schema.json" with { type: "json" };
import attemptContext from "../schemas/attempt-context.schema.json" with { type: "json" };
import assetBinding from "../schemas/asset-binding.schema.json" with { type: "json" };
import runtimeError from "../schemas/runtime-error.schema.json" with { type: "json" };

/**
 * Fixture-stage JSON Schemas (07_09 §26). These describe the RUNTIME_FIXTURE_BUNDLE
 * contract shape only — no production curriculum schema is defined here.
 */
export const schemas = {
  webContentBundleManifest,
  activityDefinition,
  presentationAdapter,
  capabilityProfile,
  semanticAction,
  attemptContext,
  assetBinding,
  runtimeError,
} as const;

export type SchemaName = keyof typeof schemas;
