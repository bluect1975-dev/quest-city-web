# WEB-M2B — Cross-Runtime Contracts, Bundle and Attempt Lifecycle

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Contracts | `packages/contracts/vendor/quest-city-platform-openapi-v1_4.yaml` (+ `provenance-v1_4.json`) | Vendored, checksum-verified v1.4 OpenAPI additive artifact (source: `quest-city-roblox` commit `5297d2d8`) |
| Migration | `infrastructure/database/migrations/0003_cross_runtime_assignment_and_attempt.sql` (+ `.rollback.sql`) | `content_bundle`, `content_bundle_runtime_channel`, `assignment`, `assignment_runtime_channel`, `learning_attempt` (attempt = learning_attempt extended, AGENTS.md D2), `attempt_response`, `semantic_action_log`, `idempotency_record`; NULL-safe lifecycle `CHECK`, `content_bundle` immutability trigger, `semantic_action_log` append-only trigger |
| Schema (rewritten, schemaVersion 2.0.0) | `packages/content-schema/schemas/{attempt-context,semantic-action,web-content-bundle-manifest,runtime-error}.schema.json` | Superseded the WEB-M0 fixture-stage shapes to match 07_08/07_09/02_26 v1.6 exactly (no consumer existed for the superseded shapes) |
| Schema (new) | `packages/content-schema/schemas/{bundle-entry,outcome,validator-fixture}.schema.json` | Filled gaps left open by 07_08/07_09 (no schema filename was ever reserved for these) |
| Package (new) | `packages/attempts` | Tenant-scoped repositories (`assignment`, `content_bundle`, `learning_attempt`, `semantic_action_log`, `idempotency_record`); `RuntimeCapabilityResolver`, `AttemptConsolidationService`, `CrossRuntimeReconciliationService` (`evaluate()` only), `IdempotencyService` (generation-based); `CrossRuntimeError`/`ErrorEnvelope` |
| Package (extended) | `packages/content-runtime` | Real SHA-256 manifest/entry integrity verification, real path-traversal protection, `resolveCompatibility` (07_09 §21 checklist), `buildAttemptContext` |
| Package (extended) | `packages/identity` | `SessionService.resolveInternalIdentity()` — exposes internal tenant/student-profile/enrollment/class UUIDs behind a session cookie, reusing the existing session-validation path, for `packages/attempts` repositories that need real foreign keys |
| Fixtures | `packages/test-fixtures/src/balance-machine-fixture.ts` (extended), `.../cross-runtime-reconciliation-fixture-driver.ts` (new, not re-exported from the package barrel) | Balance Machine fixture completed with semantic actions/validator ref/expected outcome (07_08 §25); test-only reconciliation simulation, isolated from production |
| Tooling (new) | `tools/check-fixture-isolation.mjs` | Fails the build if any production file references `CrossRuntimeReconciliationFixtureDriver` |
| Tooling (new) | `tools/seed-assignment.ts` | Administrative offline assignment seed, same security discipline as `tools/seed-pilot.ts`; validates tenant/class/bundle/runtime before writing, refuses to overwrite |
| API | `apps/api/app/assignments/[assignmentId]/route.ts`, `.../launch-context/route.ts`, `apps/api/app/attempts/[attemptId]/actions/route.ts`, `.../complete/route.ts`, `apps/api/app/progress/summary/route.ts` | The 5 WEB-M2 endpoints (`02_26 v1.6 §18`) |
| API lib | `apps/api/lib/attempts-context.ts`, `.../attempt-error-response.ts` | Wiring for `packages/attempts` services, `ErrorEnvelope` response mapping |
| Governance | `docs/adr/0003-web-m2-cross-runtime-attempt-design.md` | Local ADR for the decisions listed there |
| CI | `infrastructure/scripts/verify.sh`, `package.json` (`check:fixture-isolation` script) | Fixture-isolation gate wired into the standard verification pipeline |

## Scope record

**In scope:** read-only assignment access (no public create/update endpoint), cross-runtime attempt lifecycle
(`attemptState`/`completionStatus` distinction, six-state machine, NULL-safe database enforcement), creation/
completion idempotency (distinct mechanisms, generation-based optimistic concurrency for completion), semantic
action ingestion (canonical vocabulary only, append-only log), server-authoritative consolidation
(`AttemptConsolidationService`), cross-runtime concurrency detection (`CrossRuntimeReconciliationService.evaluate()`
only), the eighth error code `ATTEMPT_NOT_COMPLETABLE`, single aggregated (student-scoped) progress query, content
bundle manifest/entry integrity (real SHA-256, real path-traversal protection), content-schema v2.0.0, Balance
Machine fixture completion, fixture isolation enforcement, administrative assignment seed, OpenAPI v1.4 vendoring
+ provenance.

**Out of scope (explicitly, per this change set's authorization and `docs/adr/0003`):** staff authentication and
any public assignment write endpoint, real cross-runtime reconciliation resolution
(`CrossRuntimeReconciliationService.resolve()`), real validator/scoring execution (placeholder outcome only), a
presentation-adapter registry (static default adapter per runtime), dashboard UI, Roblox runtime/endpoints, M06
graphics/SpriteCook, reward, mastery, `school_session` (live/scheduled sessions), any modification to
`quest-city-roblox` or to OpenAPI v1.2/v1.3.

## Key upstream decisions this milestone relies on

- `00_01 v4.44` "Controlled update v4.44" — registers WEB-M2A's closure and WEB-M2B's dependency on it.
- `07_15_01 v1.1 §11-bis` — `attemptState`/`completionStatus` distinction, transitions, terminal states,
  `ATTEMPT_NOT_COMPLETABLE` exact conditions.
- `02_26 v1.6 §18` — endpoint list, `ErrorEnvelope`, the eight `CROSS_RUNTIME` error codes, idempotency-per-operation,
  assignment read-only.
- `AGENTS.md v4.30` §4.21 rules 16-19, decision D3 — assignment provisioning, `attemptState`/`completionStatus`,
  `runtimeChannel` input restriction, canonical-OpenAPI-before-vendoring rule, WEB-M2A/WEB-M2B sequencing.
- `AGENTS.md` §4.21 decision D2 — `attempt` = `learning_attempt` extended; no second `attempt` table (enforced
  structurally: migration `0003` never creates one).
- `02_25 §6.5-6.7/§28` — baseline `content_bundle`/`assignment`/`learning_attempt` columns and the additional
  cross-runtime fields, created together in migration `0003` since none of these tables existed yet in this
  repository.
- `07_08 §6/§9-10/§25` — canonical semantic action vocabulary, capability/adapter model (consumed, not
  redefined), validator fixture checklist.
- `07_09 §5-6/§9/§21/§22` — bundle manifest/entry shape, attempt context shape, compatibility checklist, error
  contract shape (superseded here by the `ErrorEnvelope` of `02_26 v1.6 §18.7`, see `docs/adr/0003`).
- Four WEB-M2 planning-round correction sets (2026-08-06) — SQL NULL-safety fix for the lifecycle `CHECK`,
  idempotency generation/reopening design, error namespacing, fixture-isolation requirement, and the
  disambiguation between this milestone's read-only assignment endpoint and the pre-existing, unrelated,
  not-yet-implemented `POST /assignments` of `02_26 v1.6 §15` (dashboard/staff context).

## Known residual items

- `AttemptConsolidationService.consolidate()` is fed a placeholder outcome by the API route
  (`{ consolidatedVia, finalClientSequence }`), not a real computed score — no validator/engine exists yet
  (`docs/adr/0003`). A future milestone implementing a real engine must replace this call site's outcome
  computation, not the service's contract.
- The launch-context route resolves `RuntimeCapabilityResolver` against one static default adapter per runtime
  channel — no presentation-adapter registry exists yet.
- `learning_attempt.session_id` is nullable with no foreign key enforced — `school_session` (scheduled live
  sessions, `02_25 §6.6`) does not exist yet in this repository; deferred to a future milestone that introduces
  it, not silently ignored.

## CI integration-test database (post-WEB-M2B correction)

`identity-flow.test.ts`, `identity-security.test.ts` and `attempt-lifecycle.test.ts` (WEB-M1/WEB-M2B) each connect
directly via `pg` to `process.env.DATABASE_URL`, historically defaulting (for ad hoc local runs only) to a
standalone Postgres on `localhost:5555` that no automated pipeline ever provisioned. `.github/workflows/ci.yml`'s
`integration` job previously started only Docker Compose and set `HEALTH_BASE_URL`, so these three files — plus,
independently, the whole job — would have failed on GitHub Actions: first at `docker compose up` itself, because
the job's `cp .env.example .env` step is not read by these `-f infrastructure/deployment/docker-compose.yml`
invocations (Compose resolves its default project directory, and therefore its default `.env` search location,
from the compose file's own directory, not from the invoking shell's `cwd`) — `CLASS_CODE_HASH_PEPPER` would be
unresolved and Compose would refuse to start any service; and even past that, the three DB-touching test files
would still fail with `ECONNREFUSED` on port 5555.

**Fix**: `ci.yml`'s `integration` job (and `infrastructure/scripts/verify.sh --with-integration`, kept in exact
parity so local runs reproduce CI) now:
1. generates a fresh, disposable `CLASS_CODE_HASH_PEPPER` per run and exports it into the job/script's own shell
   environment (`$GITHUB_ENV` in CI, `export` in the script) — this is what lets `docker compose` resolve the
   variable, regardless of any `.env` file's location; masked via `::add-mask::` in CI so it never appears in logs;
2. sets `DATABASE_URL` explicitly to `postgresql://quest_city_web:changeme_local_only@localhost:5434/quest_city_web`
   — the same host-mapped port Compose already publishes (`infrastructure/deployment/docker-compose.yml`, matching
   `.env.example`'s documented local-tooling convention) — reusing the Postgres Docker Compose already started,
   not a second database;
3. waits for Postgres's own healthcheck (`pg_isready`, via `docker compose exec`) before proceeding;
4. applies migrations 0001–0003 with `pnpm --filter @quest-city-web/tools run migrate` against that `DATABASE_URL`;
5. waits for `GET /api/health/ready` (not just `/health/live`, so DB reachability from the API's own perspective is
   confirmed too) before running tests;
6. runs `pnpm run test:integration` once — `tests/integration/vitest.config.ts`'s existing `fileParallelism: false`
   (already in place before this fix, not newly introduced) is what keeps the four files' shared-database
   `TRUNCATE ... CASCADE` fixtures from contaminating each other; this fix does not change that isolation strategy.

Each test file's own `localhost:5555`/`5556` fallback is left in place **only** as an ad hoc local-development
convenience for running a single file directly against a hand-started standalone container — CI and
`verify.sh --with-integration` never rely on it, since both now set `DATABASE_URL` explicitly before the tests run.

The three-Dockerfile `HOSTNAME=0.0.0.0` fix (`infrastructure/containers/{api,student-web,dashboard}.Dockerfile`,
discovered while first verifying WEB-M2B's own Docker Compose gate) is unrelated to the CI database issue above —
it fixes a separate, real problem: Docker automatically injects a `HOSTNAME` environment variable set to the
container's own ID into every container, and Next.js's standalone `server.js` binds to `process.env.HOSTNAME` when
one is present, so without this fix the server bound only to that container-ID hostname's resolved address (its
Docker-network IP) — reachable from other containers (e.g. Nginx) but not from `localhost`/`127.0.0.1` inside the
container itself, which is exactly what `api`'s own Docker `HEALTHCHECK` probes, causing it to report `unhealthy`
forever despite the service working correctly end-to-end.
