# R3B — Web Learning Engine Governance Implementation

## Scope record

**In scope:** vendoring the five R3A canonical contracts with checksum and provenance; a canonical Engine Registry
runtime (`canonicalEngineId`/`runtimeAdapterId` kept distinct, D9); a Template Registry (`templateId`+`templateVersion`);
a Capability Contract consumer keeping Axis A (interaction/activity) and Axis B (device/runtime presentation)
distinct (D8); a deterministic Support Evaluator producing only the four canonical outcomes (`SUPPORTED`,
`SUPPORTED_WITH_TEMPLATE`, `SUPPORTED_WITH_LIMITATIONS`, `ENGINE_GAP`) with the Pedagogical Fidelity Rule enforced
literally; an Engine Gap Report producer; the full test matrix required by the R3B authorization.

**Out of scope (explicitly):** the 10 documented Web engines or any of the 14 canonical engines (none registered —
the registries are empty by design, same posture as `packages/learning-engines` at WEB-M0); any new public API route
(the evaluator is an internal library, not exposed yet); any database migration (no persisted registry state at
this stage); an AI service (activity specifications and fidelity assessments are supplied by the caller, never
inferred here); R3C (public-site follow-up); WEB-M4.

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Vendored contracts (new) | `packages/content-schema/schemas/vendor/r3a/*.schema.json` (+ `provenance.json`) | Byte-identical, checksum-verified copy of the 5 R3A canonical schemas (source: `quest-city-roblox` `main` commit `945571b4...`, `02_36 v1.0`) |
| Schema registration (extended) | `packages/content-schema/src/schemas.ts`, `src/validate.ts` | Registers the 5 vendored schemas under the existing Ajv pipeline; two narrow Ajv adapter accommodations documented inline (`schemaVersion` annotation keyword, `strictRequired: false` for the `if`/`then` construction in `support-evaluation.schema.json`) — the vendored schema files themselves are never edited |
| Engine Registry runtime (rewritten) | `packages/learning-engines/src/registry.ts` (+ `registry.test.ts`) | Upgraded from the WEB-M0 flat `EngineRegistration` placeholder to the canonical `EngineRegistryEntry` shape (`engine-registry.schema.json`); lookup by `canonicalEngineId` and by `runtimeAdapterId` kept as two distinct methods, never merged |
| Template Registry (new) | `packages/learning-engines/src/template-registry.ts` (+ test) | `templateId`+`templateVersion` keyed registry conforming to `template-contract.schema.json` |
| Capability Contract consumer (new) | `packages/learning-engines/src/capability-contract.ts` (+ test) | Axis A capability-set coverage check; Axis B device/runtime-profile requirement check; the two are never combined into one comparison |
| Support Evaluator (new) | `packages/learning-engines/src/support-evaluator.ts` (+ test) | Deterministic, in-memory evaluation following the engine-selection order (capabilities → exact-match engine → template → limitations → `ENGINE_GAP`); takes an explicit `now` timestamp, never reads the clock itself |
| Engine Gap Report producer (new) | `packages/learning-engines/src/engine-gap-report.ts` | Builds a schema-valid `EngineGapReport`, called by the evaluator on the `ENGINE_GAP` path |
| Shared types (new) | `packages/learning-engines/src/types.ts` | `AxisAValue`, `AxisBProfile`, `SemanticAction`, `LifecycleStatus`, `SupportOutcome`, `EngineRegistryEntry`, `TemplateContractEntry`, `ActivitySpecification`, `FidelityAssessment`, `SupportEvaluationResult`, `EngineGapReport` — field names kept identical to the vendored schemas |
| Contract-validity tests (new) | `packages/learning-engines/src/contract-validity.test.ts`, `packages/content-schema/src/vendor-r3a.test.ts` | Confirms the runtime's actual output (not just hand-written fixtures) validates against the vendored Ajv schemas; explicit positive/negative fixtures for all 5 schemas |
| Governance | this document | Records the R3B disposition; no local `AGENTS.md` exists in this repository (audited, none found) |

## Key upstream decisions this milestone consumes (does not redecide)

- `02_36 v1.0` (`quest-city-roblox`, R3A) — Engine Registry, Capability Contract, Template Model, Support
  Evaluation, Pedagogical Fidelity Rule, Publication semantics, Engine Gap Report.
- `D8` (finalized R3A) — Axis A (`07_08 §9`, unchanged 14-value vocabulary) vs Axis B (`capability-profile.schema.json`,
  unchanged 5-field shape), never merged.
- `D9` (finalized R3A) — `canonicalEngineId` (`ENG-*`, `02_21`) vs `runtimeAdapterId` (`QC-WEB-ENGINE-*`, `07_10`),
  kept as two distinct registry lookups.
- ADR-0005/ADR-0006 (`quest-city-roblox`) — vendoring-with-checksum-and-provenance as the only sanctioned artifact
  channel between the two repositories; no filesystem coupling introduced.

## Ajv adapter accommodations (not a schema fork)

Two narrow, documented `Ajv2020` configuration additions in `packages/content-schema/src/validate.ts` let this
package's strict-mode Ajv instance compile the vendored R3A schemas without altering their content:

1. `ajv.addKeyword({ keyword: "schemaVersion" })` — the vendored schemas carry a top-level `schemaVersion`
   documentation field (a metadata annotation, not a validation rule); Ajv strict mode otherwise rejects any
   unrecognized keyword.
2. `strictRequired: false` — `support-evaluation.schema.json`'s conditional `if`/`then` blocks reference a property
   declared in the schema's own top-level `properties` without repeating it inside `then` (valid JSON Schema); Ajv's
   `strictRequired` heuristic cannot verify that without the repetition and refuses to compile otherwise.

Neither change modifies a vendored file. If a future contract genuinely cannot be expressed without a semantic
change, per the R3B authorization that is a contract gap to raise in `quest-city-roblox`, not to fork here.

## Registry state at the close of R3B

Both `EngineRegistry` and `TemplateRegistry` are empty by construction — no `register()` call outside test fixtures
exists anywhere in this change set. The Registry Update Gate (`02_36 §13.3`) is not satisfied by any candidate
engine at this stage: no real Web engine implementation, runtime adapter or passing test suite exists for any of
the 10 documented Web engines. Promoting any of them to a real, `ACTIVE` registry entry is out of scope for R3B
and requires a future, separately authorized phase.

## Test strategy

Unit tests only (no new integration surface, no new API route, no new migration — nothing for
`tests/integration` or Docker Compose to exercise beyond the existing suite, which this change set does not
touch). Coverage: registry CRUD and lookup-by-both-identifiers; template registry CRUD; Axis A/B capability
matching; the full evaluator scenario matrix (empty registry, exact match, template match, explicit
non-substantial limitation, per-dimension pedagogical-fidelity violation, `DEPRECATED`/`RETIRED` exclusion,
`preferredCanonicalEngineIds` ordering); publication-eligibility pairing (`ENGINE_GAP` ↔ `NOT_PUBLISHABLE`, every
other outcome ↔ `ELIGIBLE`); schema-contract validity for all 5 vendored schemas via both a direct fixture sweep
and the evaluator's real output.
