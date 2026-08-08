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
import balanceMachineConfig from "../schemas/balance-machine-config.schema.json" with { type: "json" };
import quickQuestionConfig from "../schemas/quick-question-config.schema.json" with { type: "json" };
import dragDropConfig from "../schemas/drag-drop-config.schema.json" with { type: "json" };
import r3aCapabilityContract from "../schemas/vendor/r3a/capability-contract.schema.json" with { type: "json" };
import r3aEngineRegistry from "../schemas/vendor/r3a/engine-registry.schema.json" with { type: "json" };
import r3aTemplateContract from "../schemas/vendor/r3a/template-contract.schema.json" with { type: "json" };
import r3aEngineGapReport from "../schemas/vendor/r3a/engine-gap-report.schema.json" with { type: "json" };
import r3aSupportEvaluation from "../schemas/vendor/r3a/support-evaluation.schema.json" with { type: "json" };
import r3c2StageOrchestrationContract from "../schemas/vendor/r3c2/stage-orchestration-contract.schema.json" with { type: "json" };

/**
 * WEB-M2 schemas (schemaVersion 2.0.0): attemptContext, semanticAction,
 * webContentBundleManifest and runtimeError are the rewritten,
 * 07_08/07_09/02_26-aligned successors of the WEB-M0 fixture-stage shapes
 * (no consumer existed for the superseded shapes — see docs/adr/0003).
 * bundleEntry, outcome and validatorFixture are new. activityDefinition,
 * presentationAdapter, capabilityProfile and assetBinding are unchanged
 * WEB-M0 fixture-stage shapes, out of WEB-M2 scope.
 *
 * R3B schemas (`r3a*`): vendored verbatim from quest-city-roblox
 * `schemas/*.schema.json` at commit `945571b4...` (R3A canonical mainline
 * integration, `02_36`), checksum-verified — see
 * `../schemas/vendor/r3a/provenance.json`. Never edited locally; a Web
 * runtime need that these schemas cannot express is a contract gap to
 * raise upstream, not to fork here.
 *
 * R3C.1 schemas (`balanceMachineConfig`, `quickQuestionConfig`,
 * `dragDropConfig`): new, Web-owned configuration schemas for the 3 P0
 * engines' `configurationSchemaRef` (`packages/learning-engines/src/engines/*`).
 *
 * R3C.2 schema (`r3c2StageOrchestrationContract`): vendored verbatim from
 * quest-city-roblox `schemas/stage-orchestration-contract.schema.json` at
 * commit `a77c1781...` (R3C.2A+B canonical mainline integration), checksum-
 * verified — see `../schemas/vendor/r3c2/provenance.json`. Never edited
 * locally. A `oneOf` of `SequenceDefinition` (authored content) and
 * `SequenceRuntimeState` (mutable per-run state), discriminated by
 * `contractType`. The orchestration layer it describes never resolves an
 * engine itself and never duplicates attemptState/completionStatus.
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
  r3aCapabilityContract,
  r3aEngineRegistry,
  r3aTemplateContract,
  r3aEngineGapReport,
  r3aSupportEvaluation,
  r3c2StageOrchestrationContract,
  balanceMachineConfig,
  quickQuestionConfig,
  dragDropConfig,
} as const;

export type SchemaName = keyof typeof schemas;
