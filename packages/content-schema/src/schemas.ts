import webContentBundleManifest from "../schemas/web-content-bundle-manifest.schema.json" with { type: "json" };
import activityDefinition from "../schemas/activity-definition.schema.json" with { type: "json" };
import presentationAdapter from "../schemas/presentation-adapter.schema.json" with { type: "json" };
import capabilityProfile from "../schemas/capability-profile.schema.json" with { type: "json" };
import semanticAction from "../schemas/semantic-action.schema.json" with { type: "json" };
import attemptContext from "../schemas/attempt-context.schema.json" with { type: "json" };
import assetBinding from "../schemas/asset-binding.schema.json" with { type: "json" };
import runtimeError from "../schemas/runtime-error.schema.json" with { type: "json" };
import bundleEntry from "../schemas/bundle-entry.schema.json" with { type: "json" };
import outcome from "../schemas/outcome.schema.json" with { type: "json" };
import validatorFixture from "../schemas/validator-fixture.schema.json" with { type: "json" };

/**
 * WEB-M2 schemas (schemaVersion 2.0.0): attemptContext, semanticAction,
 * webContentBundleManifest and runtimeError are the rewritten,
 * 07_08/07_09/02_26-aligned successors of the WEB-M0 fixture-stage shapes
 * (no consumer existed for the superseded shapes — see docs/adr/0003).
 * bundleEntry, outcome and validatorFixture are new. activityDefinition,
 * presentationAdapter, capabilityProfile and assetBinding are unchanged
 * WEB-M0 fixture-stage shapes, out of WEB-M2 scope.
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
  bundleEntry,
  outcome,
  validatorFixture,
} as const;

export type SchemaName = keyof typeof schemas;
