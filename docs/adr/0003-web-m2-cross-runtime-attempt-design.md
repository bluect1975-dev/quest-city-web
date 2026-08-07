---
adr_id: "ADR-0003"
title: "WEB-M2B: cross-runtime attempt lifecycle, idempotency, error namespacing and isolation design"
status: "Approved"
date: "2026-08-06"
related_change_set: "WEB-M2B"
---

# ADR-0003 – WEB-M2B: cross-runtime attempt lifecycle, idempotency, error namespacing and isolation design

## Context

WEB-M2A (`quest-city-roblox`, commit `5297d2d8cd6f3804ac6a277cd7fe37718d69dc07`) registered the canonical
contract for WEB-M2's data/API/attempt subset: `contracts/quest-city-platform-openapi-v1_4.yaml`,
`02_26 v1.6 §18`, `07_15_01 v1.1` (notably §11-bis, the `attemptState`/`completionStatus` distinction, and
the eighth error code `ATTEMPT_NOT_COMPLETABLE`), and `AGENTS.md v4.30` §4.21 rules 16-19 / decision D3.
Several implementation-level decisions were deliberately left open by that contract and required a concrete
choice here, most of them corrected across four planning rounds before authorization:

- How `attempt_state` and `completion_status` relate at the database-constraint level without the NULL/
  UNKNOWN-propagation trap that a naive `CHECK` produces.
- How idempotency is scoped per operation (creation vs. semantic action vs. completion), and how a `FAILED`
  idempotency record can be safely reopened under concurrency.
- How the three `ErrorEnvelope` domains (`PLATFORM`/`CONTENT_RUNTIME`/`CROSS_RUNTIME`) are represented in code
  without collapsing into one flat enum.
- What "launch-context" means as an endpoint name (07_09 §17 only gives a non-binding conceptual example;
  `02_26 v1.6` §18.2 never names it).
- How `semantic_action_log` append-only and `content_bundle` immutability are enforced at the database level,
  given no privilege-separation role model exists yet in this repository.
- How `CrossRuntimeReconciliationFixtureDriver` is kept out of the production build with no real controlled
  resolution implemented.
- What is explicitly deferred: real cross-runtime reconciliation resolution, staff-authenticated assignment
  writes, and real validator/scoring execution.

## Decision

### Attempt lifecycle (07_15_01 v1.1 §11-bis)

`attempt_state` (six values: `CREATED`, `IN_PROGRESS`, `COMPLETION_SUBMITTED`, `COMPLETED`, `ABANDONED`,
`EXPIRED`) and `completion_status` (nullable, persisted only as `ACCEPTED_NOT_CONSOLIDATED`,
`RECONCILIATION_REQUIRED` or `CONSOLIDATED` — `DUPLICATE`/`CONFLICT` are response-only values of the
completion write, never written to the row) are enforced by a single `CASE`-based `CHECK` constraint on
`learning_attempt` (migration `0003`) using only `IS [NOT] NULL`, `IS NOT DISTINCT FROM`, and an
`IS NOT NULL`-guarded `IN` — never a bare `= literal` comparison against a nullable column. A bare comparison
evaluates to `NULL` (not `FALSE`) when the column is `NULL`, and PostgreSQL accepts a row whose `CHECK`
evaluates to `NULL` — this exact defect was found in an earlier planning round (a `COMPLETED` row with
`completion_status IS NULL` passed the naive constraint) and is why the `CASE` form is mandatory here, not
a style preference. Verified with a real Postgres integration test asserting every invalid combination is
rejected (see `tests/integration/attempt-lifecycle.test.ts`).

### Idempotency, one mechanism per operation

- **Creation** (`launch-context`): `learning_attempt.creation_idempotency_key`, unique per
  `(tenant_id, assignment_id, student_profile_id)`.
- **Semantic action**: `semantic_action_log` unique constraints on `(attempt_id, action_id)` and
  `(attempt_id, client_sequence)` — no `Idempotency-Key` header, no row in `idempotency_record`.
- **Completion**: `idempotency_record`, `scope = 'attempt_completion'` only.

No table or code path implements a second mechanism for the same operation.

### `idempotency_record` FAILED-row reopening (generation-based optimistic concurrency)

`begin()` is a single atomic `INSERT ... ON CONFLICT (tenant_id, scope, scope_key) DO UPDATE ... WHERE`
statement (`packages/attempts/src/repository/idempotency-record-repository.ts`). PostgreSQL's own row-level
locking on the conflicting row makes concurrent callers on the same key race safely — at most one caller
observes `inserted_fresh` transition per generation. `complete()`/`fail()` are guarded by
`WHERE status = 'PENDING' AND generation = $expectedGeneration`; a caller whose generation is stale updates
zero rows and receives `STALE_GENERATION`, never overwriting a newer attempt. `request_hash` is never
rewritten during a reopen — the `WHERE` clause has already verified it matches the caller's payload.

### `ErrorEnvelope` and domain namespacing

`{ domain, code, httpStatus, message, correlationId, retryable, safeDetails? }` (`packages/attempts/src/errors.ts`
`CrossRuntimeError`). `packages/attempts` implements only the `CROSS_RUNTIME` domain (the eight codes of
`07_15_01 v1.1 §14`); `PLATFORM` (existing `IdentityError`/`DOMAIN_ERROR_CODES`) and the one `CONTENT_RUNTIME`
code this milestone needs (`ATTEMPT_RUNTIME_MISMATCH`, `07_08 §18` — used only by
`POST /attempts/{id}/actions` when the target attempt is not `IN_PROGRESS`) are mapped at the API route layer
(`apps/api/lib/attempt-error-response.ts` and the one inline `contentRuntimeError()` helper in the actions
route) rather than adding a `CONTENT_RUNTIME` package nobody else needs yet.

### "launch-context" naming

Adopted as a WEB-M2B-local naming choice for `POST /assignments/{assignmentId}/launch-context`, following the
non-binding conceptual precedent of `07_09 §17`. Not a requirement of `02_26 v1.6` §18.2, which only describes
the endpoint's behaviour in prose without naming it.

### Append-only / immutability enforcement (trigger-based, not role-based)

No privilege-separation role model exists in this repository — `infrastructure/deployment/docker-compose.yml`
defines a single `POSTGRES_USER` owning every table (verified). `semantic_action_log` (`BEFORE UPDATE OR DELETE`
triggers raising unconditionally) and `content_bundle` (`BEFORE UPDATE OR DELETE` trigger allowing free edits
on `DRAFT` rows, rejecting any change to protected fields once `PUBLISHED`, permitting only the
`PUBLISHED → DEPRECATED` status transition) are both enforced this way. This works regardless of which
database role executes the query. If a roles model is introduced later, `GRANT`/`REVOKE` can be layered on top
as defense-in-depth without removing either trigger.

### `CrossRuntimeReconciliationFixtureDriver` isolation

Lives in `packages/test-fixtures/src/cross-runtime-reconciliation-fixture-driver.ts`, operates on a raw `pg`
`Pool`/`PoolClient` directly (never on `@quest-city-web/attempts`'s repositories, so it has no production-code
dependency to leak), and is deliberately **not** re-exported from `packages/test-fixtures`'s barrel
(`src/index.ts`) — test code imports it by its own file path. `tools/check-fixture-isolation.mjs` scans every
source file outside `packages/test-fixtures/`, `tests/integration/`, and `*.test.ts`/`*.spec.ts` files for a
reference to it and fails the build if one is found; wired into `infrastructure/scripts/verify.sh` and
`package.json`'s `check:fixture-isolation` script. Verified to actually catch a violation, not just report a
clean scan, by a temporary planted reference during this change set (removed before commit).

### `content_bundle_version` not duplicated

`learning_attempt` stores `content_bundle_id` (FK) only, not a redundant `content_bundle_version` string —
`content_bundle` rows are immutable once `PUBLISHED` (enforced by the trigger above), so `bundle_version` is
always derivable via a join and can never diverge from a stored copy.

### Explicitly out of scope (deferred, not silently ignored)

- **Real cross-runtime reconciliation resolution.** `CrossRuntimeReconciliationService` implements `evaluate()`
  only; no `resolve()` exists in the production package. `07_15_01 v1.1 §13.3` already defers "risoluzione
  controllata" to a future implementation without prescribing a mechanism.
- **Staff-authenticated assignment writes.** No `POST /assignments` exists; assignments are pre-provisioned by
  `tools/seed-assignment.ts`, an offline administrative script (`AGENTS.md v4.30` §4.21 rule 16).
- **Real validator/scoring execution.** `AttemptConsolidationService.consolidate()` accepts a pre-computed
  outcome; `apps/api`'s complete route currently passes a placeholder object
  (`{ consolidatedVia, finalClientSequence }`), not a real score — `07_08 §8` states the runtime never returns
  outcome directly, and no engine is implemented yet (`packages/learning-engines` remains a registry only, per
  its existing WEB-M0 scope note).
- **A presentation-adapter registry.** No database table models 07_08's adapter concept; `apps/api`'s
  launch-context route resolves against one static default adapter per runtime channel, `RuntimeCapabilityResolver`
  is exercised for real but against that static input.
- **`school_session`.** `learning_attempt.session_id` is nullable with no FK enforced — `02_25 §6.7`'s
  `session_id` refers to `school_session` (`§6.6`, a scheduled live session), a different concept from the
  WEB-M1 authentication `student_session` table already in this repository, and `school_session` does not
  exist yet here. WEB-M2 is async-attempts only; no live-session concept is in scope.

## Post-approval correction: CI integration-test database wiring

While verifying this change set's gates for real (not just claiming them), `.github/workflows/ci.yml`'s
`integration` job was found to be non-functional as written even before WEB-M2B: it never set `DATABASE_URL`, so
`identity-flow.test.ts`/`identity-security.test.ts` (WEB-M1) and the new `attempt-lifecycle.test.ts` (WEB-M2B)
would have fallen back to a `localhost:5555` standalone Postgres that no automated pipeline provisions; and,
independently, the job's `cp .env.example .env` step is never actually read by its `docker compose -f
infrastructure/deployment/docker-compose.yml` invocations, so `CLASS_CODE_HASH_PEPPER` would be unresolved and
Compose would refuse to start any service at all. Fixed by generating an ephemeral pepper directly into the job's
shell environment (`$GITHUB_ENV`, masked) and setting `DATABASE_URL` explicitly to the Postgres Docker Compose
already starts (host-mapped port 5434) rather than introducing a second database — full detail and rationale in
`docs/implementation/web-m2-contracts-bundle-attempt.md`'s "CI integration-test database" section. This does not
change any decision recorded above; it corrects the pipeline that verifies them.

## Consequences

- Any future engine/validator implementation must populate a real outcome object matching `outcome.schema.json`
  in place of the current placeholder — a follow-up change set, not a silent behavior change.
- A future staff-authentication milestone that introduces `POST /assignments` and a real
  `CrossRuntimeReconciliationService.resolve()` should reuse the `CROSS_RUNTIME` error domain and the
  generation-based idempotency pattern established here rather than inventing a parallel one.
- If a presentation-adapter registry is introduced, `RuntimeCapabilityResolver`'s call site in the
  launch-context route needs to source `availableAdapters` from it instead of the current static default.
