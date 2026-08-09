# WEB-M4 — First Real Student Learning Experience

**Status:** implemented. **Branch:** `feature/web-m4-first-real-learning-experience`. **Authority:** `quest-city-roblox` `07_25 v1.0` (canonical scope, merged `main` @ `0ac8f6a5536634ed010088bac14140c1c4e334cf`). **Migration:** none new — reuses R3C.1/R3C.2/R3C.3's existing schema unchanged.

**Scope:** the first end-to-end real student journey — login → home → real M06 activity → real Learning Engine → real attempt → persisted result → durable resume — using exactly the 8 in-scope elements of `07_25` §7 (A–H), no more.

**Out of scope (07_25 §8, unchanged by this phase):** teacher authoring, AI content generation, full curriculum browser, city map, final SpriteCook artwork, multi-language expansion, the ≥5-engine catalog gate (`FUTURE_CATALOG_COMPLETION_GATE`, not a WEB-M4 blocker), leaderboard/gamification, Roblox runtime/linking, the full `07_15` QA suite (stays the pilot gate). No new Learning Engine. No modification to `quest-city-roblox`.

## Real content materialization (§7-C, §9, §16)

The real M06 unit is `packages/content-runtime/src/content/web-m4-real-content.ts` — not a fixture, not a demo config (contrast `packages/test-fixtures` and `apps/student-web/lib/engine-demo-configs.ts`, both still untouched and still fixture/demo-only).

**Source (read-only, `quest-city-roblox` `main` @ `0ac8f6a5536634ed010088bac14140c1c4e334cf`):**
- `docs/03-mathematics/03_14_..._Balance_Machine_Challenge_Package_Specification_v1_0.md` §11-12 — challenge `MAT-M06-VS-CH001`, baseline difficulty variant VS-A: `3x - 4 = 11`.
- `docs/03-mathematics/03_33_..._Executable_Content_Package_v1_1.md` §4 — lesson `MAT-M06-U01-L01` phase L8 unlocks `MAT-M06-VS-CH001`.

**Mapping decision (documented, not silent):** the implemented `ENG-BALANCE` (`07_10` §13) models a single-step weight-equality check on a two-pan scale — it does not execute VS-A's full two-step algebraic solve (`+4`, then `÷3`). This bundle materializes VS-A's balanced-verification step using the exact numbers from the canonical spec: transposing `-4` gives `3x = 11 + 4`, i.e. `15 = 15`. Three weight tokens, all real numbers, none invented:

| Token | Weight | Side (correct solution) |
|---|---|---|
| `term-3x` | 15 (the value of `3x` at the true solution `x=5`) | left |
| `constant-11` | 11 (original right-hand-side constant) | right |
| `constant-4` | 4 (the transposed `-4`) | right |

Verified functionally (not just by construction) in `packages/content-runtime/src/content/web-m4-real-content.test.ts`: the real `BalanceMachineEngine` evaluates this exact placement as `CORRECT`, and a deliberately-unbalanced placement as `INCORRECT` — both through the real engine, never simulated.

**Bundle:** `WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST` — `bundleType: "ACTIVITY_BUNDLE"` (not `RUNTIME_FIXTURE_BUNDLE`, per `07_25` §16's explicit instruction), schema-validated via `loadBundleManifest()` (real SHA-256 integrity digest, real entry digest, real path-safety check — same validator R3C.1 already shipped, previously untested against anything but the fixture). `bundle-loader.ts`'s `SERVABLE_BUNDLE_TYPES` extended from `{RUNTIME_FIXTURE_BUNDLE}` to `{RUNTIME_FIXTURE_BUNDLE, ACTIVITY_BUNDLE}` — the minimum change to let this real type validate, not a general content pipeline.

**Materialization is administrative/seed, not a public endpoint** (07_25 §17, same precedent as `tools/seed-assignment.ts`/`tools/seed-pilot.ts`): `tools/seed-content-bundle.ts` inserts one `content_bundle` row with a **fixed, non-random `id`** (`WEB_M4_MAT_M06_CONTENT_BUNDLE_ID`) — required because `packages/attempts/src/services/engine-dispatch-resolution.ts` resolves the real Learning Engine config from `attempt.contentId`, and real `launch-context` sets `attempt.contentId = content_bundle.id`. The dispatch table is keyed on that same fixed id by construction, not by convention (mirrors, and actually completes, the pre-existing but never-reachable-in-production `"fixture-balance-machine"` dispatch entry). `tools/seed-assignment.ts` (unmodified, pre-existing) then creates the assignment (`--public-id asn_web_m4_balance_machine`) pointing at the seeded bundle.

## Student IA / routes (§7-B/D/G, §15)

```
/w                         — redirect gate: authenticated -> /w/home, unauthenticated -> /w/login
/w/login                   — real login form (named explicitly in the authorization's own §16 routing section)
/w/home                    — session status + the one real WEB-M4 activity + entry point + (regression) links to the existing R3C.1/R3C.2 demo surfaces
/w/activity/:activityId    — real activity launch (activityId = the assignment's id, same identifier apps/api's own GET /assignments/{assignmentId} already returns as "assignmentId" — there is no separate public/internal split for assignments in this codebase)
/w/result/:attemptId       — real result view
```

`/w/engine/:runtimeAdapterId` and `/w/sequence` (R3C.1/R3C.2 demo surfaces) are untouched and remain reachable — linked from `/w/home`'s secondary section, not deleted or hidden.

## Login (§5, §7-A)

`apps/student-web/app/w/login/page.tsx` — reuses `POST /web-auth/session/start` (no new identity system). `apps/student-web/lib/student-api-client.ts` is the new request layer (mirrors `apps/dashboard/lib/staff-api-client.ts`'s pattern); `apps/student-web/lib/student-auth-context.tsx` is the new React context (mirrors `staff-auth-context.tsx`, but reads the CSRF token from `session-client.ts`'s `sessionStorage` key — the convention R3C.2/R3C.3's `SequenceHost` already established — so, unlike the dashboard's deliberate in-memory-only choice, a same-tab reload keeps the session usable). States handled: loading (submit button label), validation (native HTML5 required/minLength/maxLength/pattern), invalid credentials (`translateErrorCode` off the real `ErrorEnvelope.code`, never `.message`), success redirect (`/w/home`).

## Activity launch, engine, attempt (§7-D/E/F, §10-13)

`/w/activity/:activityId` (`apps/student-web/app/w/activity/[activityId]/page.tsx`):
1. `POST /assignments/{assignmentId}/launch-context` with a **stable, sessionStorage-persisted** idempotency key (a reload replays the same creation key and resumes the same attempt, rather than creating a new one every mount).
2. Renders `SequenceHost` with a new **single-stage** `SequenceDefinition` (`WEB_M4_ACTIVITY_SEQUENCE_DEFINITION`, `content-runtime`) wrapping the real activity — this is how WEB-M4 satisfies both §7-E (reuse `EngineHost`/`SequenceHost`, no new runtime UI) and §7-H (durable resume) with a single real activity, without inventing a second persistence mechanism for a bare `EngineHost` usage: only `SequenceHost` is wired to R3C.3's durable `SequenceRuntimeState`.
3. `EngineHost` gained an optional `config` override (real config replaces the demo-config lookup when supplied) and an optional `onAction` callback (mirrors every locally-accepted semantic action, alongside the existing client-side engine simulation) — both additive, the demo pages (`/w/engine/*`, `/w/sequence`) are unaffected. `SequenceHost` gained matching `stageConfigs`/`onAction`/`onComplete` props, all optional.
4. Every mirrored action is POSTed to `POST /attempts/{attemptId}/actions` (real semantic-action log, real `CREATED -> IN_PROGRESS` transition on the first one). `handleComplete` **awaits every in-flight action POST** before calling `POST /attempts/{attemptId}/complete` — avoiding a real race where completion could otherwise reach the server before the last (`CONFIRM_SOLUTION`) action row exists, which `checkFinalClientSequence`'s `MISSING_ACTION` check would then correctly reject.
5. On success, redirects to `/w/result/:attemptId`.

Server-side scoring is unchanged and untouched: `AttemptConsolidationService` resolves the engine from `attempt.contentId` via `engine-dispatch-resolution.ts` and replays the persisted actions through the real `BalanceMachineEngine` — the route never accepts a client-proposed outcome.

## Result view (§7-G, §14)

New endpoint `GET /attempts/{attemptId}` (`apps/api/app/attempts/[attemptId]/route.ts`) — no equivalent existed before WEB-M4 (only the staff-only `GET /attempts/{attemptId}/review`). Session-cookie auth only (read, no CSRF), ownership enforced by `attempt.studentProfileId === identity.studentProfileId`, same check as the existing `actions`/`complete` routes. `/w/result/:attemptId` renders the real `attemptState`/`completionStatus`/`outcome`/timestamps — never a hardcoded demo result.

## Durable resume (§7-H)

Entirely reused, unmodified: `SequenceHost`'s existing R3C.3 bootstrap (`loadSequenceRuntimeState`/`createSequenceRuntimeState`/`saveSequenceRuntimeState`, keyed by `sequenceId`) now runs against the real WEB-M4 sequence id instead of only the `/w/sequence` demo id. A refresh mid-activity reloads the persisted `SequenceRuntimeState` from Postgres and resumes at the correct stage — the same mechanism, same tests-proven durability (`tests/integration/sequence-runtime-state.test.ts`), applied to real content for the first time.

## Discovery: `07_09` §17 launch-context route

`07_25` §17 explicitly left unverified whether `GET /api/content/v1/activities/{activityId}/launch-context` (the logical-shape spec in `07_09` §17) was implemented. It is not — the real, implemented primitive is `POST /assignments/{assignmentId}/launch-context`, keyed by the assignment's `id`. WEB-M4 reuses that existing route as-is (07_25 explicitly permits deciding the `activityId` → `assignmentId` mapping at implementation time) rather than building the `07_09` §17 route, which would be new API surface beyond what §9/§17 requires ("riuso di `web-auth/session/start` esistente; verifica puntuale di `launch-context`").

## Security (§19)

- Student session validated server-side on every route (`resolveInternalIdentity`); no client-supplied `studentProfileId`/`tenantId` is ever trusted.
- CSRF enforced on every mutating call (`launch-context`, `actions`, `complete`) — unchanged existing guard.
- `GET /attempts/{attemptId}` ownership-checked, tenant-scoped by construction (`findByIdAndTenant`).
- No PII beyond the existing `displayAlias` already returned by `/me/student-context`.

## Test strategy (§23)

- `packages/content-runtime/src/content/web-m4-real-content.test.ts` — manifest validity, config validity, the real engine actually scores the declared solution `CORRECT` and a wrong placement `INCORRECT`, sequence definition wiring.
- `apps/student-web/components/engine-host/EngineHost.test.tsx` — config override + `onAction` mirroring, through the real engine.
- `apps/student-web/app/w/login/page.test.tsx`, `.../home/page.test.tsx`, `.../result/[attemptId]/page.test.tsx` — required fields, loading/error states, auth-status routing, real data rendering. `apps/student-web/vitest.config.ts` extended to include `app/**`/`lib/**` (previously `components/**` only), matching `apps/dashboard`'s existing convention.
- `tests/integration/web-m4-activity-flow.test.ts` — real Postgres: seeds the real content bundle + assignment (same SQL shape as the two seed scripts), runs the exact launch-context/actions/complete sequence the API routes perform, asserts `CONSOLIDATED`/`CORRECT`, and asserts the ownership/tenant-isolation checks the new `GET /attempts/{attemptId}` route relies on.
- No browser/e2e framework exists in this repository (pre-existing, R3C.2's own doc note) — the browser walkthrough (§25 of the authorization) is manual, documented in the final report.
