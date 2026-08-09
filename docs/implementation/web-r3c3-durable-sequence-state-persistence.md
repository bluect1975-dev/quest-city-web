# R3C.3 — Durable Sequence Runtime State Persistence

**Status:** implemented. **Branch:** `feature/r3c-3-durable-sequence-state`. **Migration:** `0005` (new). **Scope:**
make `SequenceRuntimeState` (Stage/Session Orchestrator, `packages/content-runtime`) genuinely durable across
process/container restarts and new requests — the exact gap the R3C.2 doc's own Persistence decision section left
as explicit future work (`InMemorySequenceRuntimeStateStore` only).

**Out of scope (explicitly, per the R3C.3 authorization's own DIVIETO FINALE):** any modification to a Learning
Engine or the attempt lifecycle canonical model; any modification to `quest-city-roblox`; WEB-M4; a merge to
`main` (this phase ends at a pushed feature branch, same two-step pattern as every prior R3C.* phase).

## Storage model

New table `sequence_runtime_state` (migration `0005_durable_sequence_runtime_state.sql`):

| Column | Purpose |
|---|---|
| `id` | Surrogate PK (`gen_random_uuid()`), same convention as every other table in this schema. |
| `tenant_id`, `student_profile_id`, `enrollment_id` | Ownership — see below. |
| `sequence_id`, `sequence_version` | Denormalized from `state_json` for indexing/lookup without parsing JSON. |
| `current_stage_id`, `sequence_completion_state` | Also denormalized, for the same reason — never independently mutated; always written together with `state_json` in the same statement. |
| `state_json` | The full `SequenceRuntimeState` contract shape, byte-for-byte what `stage-orchestration-contract.schema.json`'s `additionalProperties: false` allows — no DB-only metadata smuggled inside it. |
| `version` | Optimistic-concurrency counter — see Idempotency/concurrency below. |
| `created_at`, `updated_at` | Standard. |

`UNIQUE (tenant_id, student_profile_id, sequence_id)`: one active runtime state per student per sequence.
`UNIQUE (runtime_state_id, tenant_id)`: the contract's own opaque id stays unique per tenant, but is never itself
the lookup key from outside this table (see Ownership).

## Ownership

A runtime state is looked up **exclusively** by `(tenantId, studentProfileId, sequenceId)`, resolved server-side
from the session (`SessionService.resolveInternalIdentity`) — never by the opaque `runtimeStateId` alone, and
never from a client-supplied tenant/student value. `SequenceRuntimeStateRepository.findByStudentAndSequence` is
the only read path; there is no `findById`. This makes it structurally impossible for one student to read or
write another student's progress by guessing or forging an id, including within the same tenant (integration
test: `sequence-runtime-state.test.ts` → "ownership: another student's row is never returned, even within the
same tenant").

## Repository

`packages/attempts/src/repository/sequence-runtime-state-repository.ts` — mirrors
`LearningAttemptRepository`'s constructor-injected `Queryable` pattern (no shared base-repository class, same as
every other repository in this codebase). Deliberately placed in `packages/attempts`, not `packages/content-runtime`
— `content-runtime` stays persistence-agnostic by design (no `pg` dependency); `attempts` already depends on both
`content-runtime` and `pg` and already hosts every other bespoke repository here.

`DurableSequenceRuntimeStateStore` (`packages/attempts/src/services/durable-sequence-runtime-state-store.ts`)
adapts the repository to the existing `SequenceRuntimeStateStore` interface (`content-runtime`) — the same
persistence-agnostic seam R3C.2 defined, now with a second, real implementation alongside
`InMemorySequenceRuntimeStateStore`. One instance is constructed per request, bound to the caller's
server-resolved identity; it tracks the version returned by its own last `get`/`save` internally, which is safe
exactly because an instance's lifetime is one request's read-then-write, never shared across requests or
students.

## API / server boundary

`apps/api/app/sequence-runtime-state/[sequenceId]/route.ts` — `GET` (load), `POST` (create), `PUT` (version-guarded
save). Same session+CSRF pattern as every other mutating WEB-M2/M3 route
(`readSessionToken`/`isTrustedOrigin`/`getCsrfTokenHeader`), same `ErrorEnvelope` shape, `CONTENT_RUNTIME` domain
(matching the existing ad-hoc codes used by `/attempts/{id}/actions`). No admin/authoring surface — exactly load
and save/apply, nothing else, per the authorization's own explicit boundary.

`apps/student-web/lib/sequence-runtime-state-client.ts` is the client-side fetch wrapper; `SequenceHost.tsx` calls
it on mount (load-or-create) and after every mutation (save) whenever a CSRF token is present in
`sessionStorage` (`apps/student-web/lib/session-client.ts`). No client-side login UI exists yet in
`apps/student-web` — out of scope, same as R3C.2's own "not the final WEB-M4 UI" posture — so with no stored CSRF
token `SequenceHost` falls back to the exact prior pure-`useState`, non-persistent behaviour. This is a real,
tested code path (integration-tested at the repository/store-adapter layer, and exercised end-to-end via a real
session in the phase's own durability smoke test), not a stub.

## Resume flow

On mount, `SequenceHost` calls `loadSequenceRuntimeState(sequenceId)`. Found → the persisted `SequenceRuntimeState`
becomes the component's initial state and the student resumes exactly where they left off (`currentStageId`,
`hintLevel`/`hintCount`, `attemptsForStage`, `checkpointReached`, `remediationTriggered`, `attemptReferences`,
`sequenceCompletionState` — every field the R3C.3 authorization required). Not found → a fresh
`SequenceRuntimeState` is created locally (`initializeSequence`, with a fresh `crypto.randomUUID()` runtime state
id) and persisted via `createSequenceRuntimeState`. There is no silent restart-from-Stage-1 path: a load failure
(session expired, network error) falls back to pure in-memory for that session rather than either fabricating a
"resumed" state or discarding real persisted progress.

## Write semantics

Every orchestrator mutation the R3C.3 authorization lists is persisted: sequence initialization (`create`), hint
request/escalation (`requestHint` → `save`), attempt reference addition (`addAttemptReference` → `save`),
remediation (`receiveEngineResult`'s `REMEDIATION_TRIGGERED` branch → `save`), checkpoint (`markStageComplete`'s
`checkpointReached` → `save`), stage transition (`advanceStage` → `save`), sequence completion (`advanceStage`'s
terminal branch → `save`). `SequenceHost`'s three mutation handlers (`handleEvaluated`, `handleContinue`,
`handleRequestHint`) all funnel through the single `persist()` helper, so no mutation path can silently skip the
write.

## Idempotency / concurrency

`version` column, identical optimistic-concurrency shape to `ReviewQueueItemRepository.transitionStatus`
(migration 0004): `UPDATE ... SET version = version + 1 ... WHERE ... AND version = $expected`. Zero rows updated
→ the repository returns `null`, the API route maps that to a 409 `SEQUENCE_RUNTIME_STATE_VERSION_CONFLICT`, the
client reloads and reconciles rather than blindly retrying. No new `idempotency_record` scope was added: unlike
creation-type operations (`attempt_completion`, `staff_feedback_create`, ...), runtime-state mutations are
repeated transitions over one row — the same shape `review_queue_item`'s own `transitionStatus` already uses
without `idempotency_record`. `addAttemptReference` is additionally dedup-safe by construction (skips a duplicate
`{stageId, attemptId}` pair before it ever reaches a write) — the version column plus this existing domain-level
dedup together satisfy the authorization's three named failure scenarios (double hint increment, duplicate
`attemptReferences`, double stage skip/double completion): all three require a write to land twice, and the
version guard structurally prevents a second write on a stale base from ever succeeding.

## Attempt boundary

`state_json` never contains `attemptState`/`completionStatus`/`correctness`/`evidence` — `AttemptReference` stays
`{stageId, attemptId}` only, unchanged from R3C.2, verified against the vendored contract schema
(`additionalProperties: false`) on every `create`/`save`.

## Failure / recovery

Covered by `tests/integration/sequence-runtime-state.test.ts`: a stored row with malformed `state_json` throws
loudly on read (never silently treated as absent); an unknown `sequenceId` returns `null` (not an error, not a
fabricated `NOT_STARTED` row); reloading an already-`COMPLETED` sequence returns it unchanged; `save()` against a
nonexistent row returns `null` rather than creating one; a stale-version `save()` never overwrites the current
row (concurrent-write test: exactly one of two racing writes lands, `hintCount` increments exactly once).

## InMemory vs Durable parity

`sequence-runtime-state.test.ts` drives the identical mutation sequence (`initializeSequence` →
`requestHint` → `advanceStage` × 3 → completion) through both `InMemorySequenceRuntimeStateStore` and
`DurableSequenceRuntimeStateStore` via the shared `SequenceRuntimeStateStore` interface and asserts the two final
states are `deepEqual` — the domain behaviour is genuinely equivalent, not merely assumed from the shared
interface type.

## Migration

`0005_durable_sequence_runtime_state.sql` / `.rollback.sql` — additive only (`CREATE TABLE` + one index), no
change to `0001`–`0004`. `sequence_runtime_state` FKs `student_profile`/`school_enrollment` via the established
`(id, tenant_id) -> (id, tenant_id)` composite pattern; no change to any existing table.

## Regression

Unaffected by this phase: production `EngineRegistry` (0 registrations) / `EngineRuntimeRegistry` (3 engines),
`StageOrchestrator` (still not an `EngineDefinition`, no modification), Nginx `/_next/static/*` routing,
WEB-INFRA-HEALTH-02 deterministic readiness gates, WEB-M3 staff/dashboard flows. R3C.3 touches only
`infrastructure/database/migrations/0005_*`, `packages/attempts` (new repository/service), `apps/api` (one new
route + context factory), `apps/student-web` (durable wiring in `SequenceHost` + two new client modules),
`packages/i18n` (one new catalog key), and `packages/content-runtime`'s own doc comment (no code change there).
