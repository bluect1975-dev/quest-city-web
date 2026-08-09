# R3C.2 — Web Stage / Session Orchestration Implementation

## Scope record

**In scope:** vendoring the R3C.2A+B canonical `stage-orchestration-contract.schema.json` with checksum and
provenance; TypeScript consumer types + Ajv validation for `SequenceDefinition`/`SequenceRuntimeState`; a
Stage/Session Orchestrator in `packages/content-runtime` (never an `EngineDefinition`, never enters the Engine
Registry); engine dispatch reusing the existing `EngineRuntimeRegistry`/Support Evaluator, never resolving an
engine by any other means; hint level/count gating; progression (advance/retry/remediation) and checkpoint
tracking; a persistence-agnostic `SequenceRuntimeState` store seam; a narrow `recordStageAttempt` adapter in
`packages/attempts` that records only `{stageId, attemptId}` pointers; a minimal `SequenceHost` UI under
`/w/sequence`, wrapping the unmodified per-engine `EngineHost`; the full test matrix required by the R3C.2
authorization.

**Out of scope (explicitly):** any new canonical engine (`GuidedPracticeEngine`, `MultiStageQuestEngine`,
`NumericInputEngine`); any modification to `quest-city-roblox`; real M06 curriculum content (the sequence used for
tests/UI is a demonstration fixture, same posture as R3C.1's Engine Host); a persistent (Postgres-backed)
`SequenceRuntimeState` store — no Web document currently assigns that storage decision, see the Persistence
decision section below; a production governance `EngineRegistry` wiring (the Registry Update Gate, `02_36 §13.3`,
remains untouched — production `EngineRegistry` stays empty by design; `EngineRuntimeRegistry`, the executable
registry, is unchanged at 3 registered engines); WEB-M4.

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Vendored contract (new) | `packages/content-schema/schemas/vendor/r3c2/stage-orchestration-contract.schema.json` (+ `provenance.json`) | Byte-identical, checksum-verified copy of the R3C.2A+B canonical schema (source: `quest-city-roblox` `main` commit `a77c1781...`) |
| Schema registration (extended) | `packages/content-schema/src/schemas.ts` | Registers `r3c2StageOrchestrationContract` under the existing Ajv pipeline — no new Ajv accommodation was needed (the schema compiles cleanly under the existing `strict`/`strictRequired: false` configuration) |
| Byte-equality test (new) | `packages/content-schema/src/vendor-r3c2.test.ts` | Re-reads the vendored file, recomputes SHA-256, asserts it matches `provenance.json` — closes a gap the R3A vendoring instance left as commit-time-trust-only; plus positive/negative fixtures |
| Consumer types (new) | `packages/content-runtime/src/stage-orchestration-types.ts` | Hand-maintained TS mirror of the schema (`SequenceDefinition`, `StageDefinition`, `EngineDispatchRef`, `ProgressionRule`, `HintPolicy`, `RemediationPolicy`, `CheckpointPolicy`, `SequenceRuntimeState`, `StageRuntimeState`, `AttemptReference`); `parseSequenceDefinition`/`parseSequenceRuntimeState` are the only sanctioned way to turn `unknown` data into these types, always through `validateAgainst()` |
| Orchestrator (new) | `packages/content-runtime/src/stage-orchestrator.ts` (+ test) | `initializeSequence`, `resolveCurrentStage`, `resolveEngineDispatch`, `receiveEngineResult`, `requestHint`, `advanceStage`, `redirectToRemediationTarget`, `addAttemptReference`, `abandonSequence`, `isSequenceComplete` — see State ownership / Dispatch / Hint flow sections below |
| Persistence seam (new) | `packages/content-runtime/src/sequence-runtime-state-store.ts` (+ test) | `SequenceRuntimeStateStore` interface + `InMemorySequenceRuntimeStateStore` — see Persistence decision |
| Attempt integration (new) | `packages/attempts/src/services/sequence-stage-attempt-integration.ts` (+ test) | `recordStageAttempt(state, stageId, attempt)` — reads only `attempt.id`, structurally unable to leak `attemptState`/`completionStatus` into `SequenceRuntimeState` |
| Engine Host extension (extended) | `apps/student-web/components/engine-host/EngineHost.tsx` | New optional `onEvaluated` prop, invoked with the real `engine.evaluate()` result right after a confirmed evaluation — additive, default behaviour unchanged, no existing R3C.1 test touched |
| Sequence UI (new) | `apps/student-web/components/engine-host/SequenceHost.tsx`, `apps/student-web/app/w/sequence/page.tsx`, `apps/student-web/lib/sequence-demo.ts` | Minimal Stage/Session UI: current stage, hint level/count, remediation flag, checkpoint badge, progression, completion — wraps `EngineHost` unmodified per interactive stage |
| i18n | `packages/i18n/src/locales/it-IT/student-web.json` | New `sequence.*` key group (anti-hardcoding gate re-verified clean) |
| Governance | this document | Records the R3C.2 disposition |

## Key upstream decisions this milestone consumes (does not redecide)

- `GUIDED_PRACTICE_IS_ORCHESTRATION_LAYER` (R3C.2A, `02_36 §20-bis`) — `GuidedPracticeEngine`/`MultiStageQuestEngine`
  are `ORCHESTRATION_LAYER_CANDIDATE`, not `ENGINE`. This orchestrator is exactly that layer; it is never given a
  `canonicalEngineId` and never registered.
- The R3C.2B canonical contract (`02_36 §11-bis`) — `SequenceDefinition` vs `SequenceRuntimeState` as two distinct
  types discriminated by `contractType`; the orchestration layer never owns validator logic; `AttemptReference` is
  a pure pointer.
- `STAGE_ADVANCED`/the internal event vocabulary (schema `lastTransitionEvent` enum) replaces the never-canonical
  `ADVANCE_STAGE` removed from `07_13 §10` in R3C.2A — this vocabulary is never merged with `SemanticAction`.
- ADR-0005/ADR-0006 (`quest-city-roblox`) — vendoring-with-checksum-and-provenance as the sanctioned artifact
  channel; no filesystem coupling introduced.

## State ownership

Exactly as the canonical contract assigns it (`02_36 §20-bis.8`):

- **Orchestrator-owned** (`SequenceRuntimeState`/`StageRuntimeState`): `currentStageId`, `hintLevel`, `hintCount`,
  `attemptsForStage`, `checkpointReached`, `remediationTriggered`, `sequenceCompletionState`, `attemptReferences`
  (pointers only).
- **Engine/attempt-owned, untouched** (`packages/attempts`, `02_26 §18.6`): `attemptState`, `completionStatus`,
  correctness, evidence. The orchestrator never reads or writes these fields; `receiveEngineResult` takes an
  already-computed `EngineEvaluationResult` as input and never recomputes correctness itself (verified directly —
  `stage-orchestrator.test.ts`'s "no validator duplication" suite).

## Engine dispatch

`resolveEngineDispatch(stage, deps)` supports exactly the two modes the contract declares, never a third:

- **`RUNTIME_ADAPTER_ID`** — direct `EngineRuntimeRegistry.getByRuntimeAdapterId()` lookup. An unknown id returns
  `{resolved: false}` with a reason string; there is no fallback substitution (mirrors the R3C.1 attempt-dispatch
  precedent).
- **`SUPPORT_EVALUATOR`** — delegates to the existing `evaluateSupport()` (`packages/learning-engines`), given a
  caller-supplied governance `EngineRegistry`/`TemplateRegistry`/`EvaluateSupportOptions`. If none is supplied, or
  the evaluation resolves to `ENGINE_GAP`/no `selectedEngine`, resolution is unresolved — no silent fallback. The
  test suite and the M06-style fixture in `stage-orchestrator.test.ts` build a local governance registry via the
  already-exported `createP0EngineRegistryEntries()` purely for evaluation purposes; **this is not wired into any
  production path** — the production governance `EngineRegistry` remains empty by design (Registry Update Gate),
  unchanged by this phase.

Both modes always resolve through the existing `EngineRuntimeRegistry`; the orchestrator never calls
`applyAction`/`evaluate` itself and never becomes an `EngineDefinition`.

## Hint flow

`requestHint()` governs only `hintLevel`/`hintCount` gating (`HintPolicy.maxHintLevel`). Hint content itself is
never held by the orchestrator — it remains content/bundle-owned, presented by the active engine in response to
the existing `REQUEST_HINT` semantic action, reused unchanged. Requesting a hint past `maxHintLevel` still
increments `hintCount` (for analytics/attempt-count purposes) but leaves `hintLevel` unchanged, and is a distinct
internal event (`HINT_REQUESTED` vs `HINT_LEVEL_ADVANCED`).

## Progression / remediation / checkpoint

`receiveEngineResult()` applies the current stage's `ProgressionRule` to an already-computed evaluation result:

- `ON_ENGINE_EVALUATION_ANY` / `ON_STAGE_CONFIRM` — advances (marks the stage `COMPLETED`) regardless of
  correctness.
- `ON_ENGINE_EVALUATION_CORRECT` — advances only if `correctness === "CORRECT"`; otherwise increments
  `attemptsForStage` and either retries (`RETRY`) or, once `attemptsForStage` reaches
  `maxAttemptsBeforeRemediation` and the stage declares a `remediationPolicy`, flags `remediationTriggered` and
  emits `REMEDIATION_TRIGGERED`.
- `MANUAL` — never auto-advances; the caller must call `advanceStage()` explicitly.

Marking a stage `COMPLETED` sets `checkpointReached: true` when the stage's `checkpointPolicy.isCheckpoint` is
true. `receiveEngineResult`'s `ADVANCED` outcome does **not** itself move `currentStageId` — `advanceStage()` is a
separate, explicit call, matching the contract's distinct `STAGE_ADVANCED` event (a caller may need to show
hint/remediation state before committing to advance).

## Persistence decision

No generic persistence abstraction exists in this repository to reuse — every existing table
(`packages/attempts/src/repository/*`) is a bespoke, hand-written-SQL repository over a specific
`learning_attempt`-family table, by design. The canonical contract itself leaves `SequenceRuntimeState`
persistence ownership out of scope (`runtimeStateId` is documented as an opaque identifier).

A real production `learning_sequence_runtime_state` table (its own migration, its own bespoke repository) is a
genuine new-storage decision this phase does not have standing authority to make unilaterally — no existing Web
document assigns sequence-runtime persistence to a specific table or service. Per the phase authorization's own
allowance ("è ammessa un'interfaccia persistence-agnostic se sufficiente per completare e testare correttamente il
runtime layer"), this phase ships only `SequenceRuntimeStateStore` (interface) +
`InMemorySequenceRuntimeStateStore` (the only implementation) — sufficient to initialize, drive and test the full
demonstration sequence end to end and to back the `SequenceHost` UI's local session state. **No migration was
added; migrations remain at `0001`–`0004`, unchanged.** A real persistent implementation is future work, to be
authorized and scoped once a Web document assigns it a concrete storage decision.

> **Superseded by R3C.3** (`docs/implementation/web-r3c3-durable-sequence-state-persistence.md`): the real,
> durable Postgres-backed implementation described as future work above now exists — migration `0005`,
> `SequenceRuntimeStateRepository`/`DurableSequenceRuntimeStateStore` (`packages/attempts`). This section is left
> unmodified as an accurate record of the R3C.2-era decision; see the R3C.3 doc for the current state.

## Test strategy

Unit tests: `stage-orchestrator.test.ts` (26 tests) covers contract parsing, initialize/enter-stage, both dispatch
modes (including unknown-adapter and `ENGINE_GAP` unresolved cases), hint request/escalation/plateau,
retry/remediation/checkpoint, `STAGE_ADVANCED`/`SEQUENCE_COMPLETED` transitions, `attemptReferences`
add/dedupe, no-validator-duplication (including a real-engine-evaluation cross-check via `replayActions`),
invalid-stage handling (`UnknownStageError`), resume-from-externally-supplied-state, and a full M06-style 8-stage
traversal dispatching all 3 real P0 engines (`ENG-QUICK`, `ENG-DRAG` via `SUPPORT_EVALUATOR`, `ENG-BALANCE`).
`vendor-r3c2.test.ts` (7 tests) covers byte-equality against `provenance.json` plus schema fixtures.
`sequence-runtime-state-store.test.ts` (3 tests) and `sequence-stage-attempt-integration.test.ts` (2 tests) round
out the new surface. Full workspace regression (`pnpm run test`, 17 workspaces, 438 tests) re-run clean —
R3C.1 engine tests, R3B Support Evaluator, WEB-M3 staff/dashboard flows and the attempt lifecycle suite all pass
unchanged. `infrastructure/scripts/verify.sh --with-integration` (the full CI-equivalent gate, including the real
Docker Compose stack, migrations `0001`–`0004`, and the full integration suite) re-run clean, `REAL_EXIT_CODE 0`.
Direct HTTP smoke against the running containerized stack (`/api/health/ready`, `/w`, all 3 engine host routes,
`/w/sequence`) all `200`; a full browser walkthrough of the demonstration sequence (start → Quick with hint
escalation → Drag and Drop → Balance Machine checkpoint → completion) was driven end to end with zero console
errors.
