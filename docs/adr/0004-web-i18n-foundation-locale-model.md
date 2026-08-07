---
adr_id: "ADR-0004"
title: "WEB-I18N-FOUNDATION I18N-B: locale model implementation, presentationLocale wiring and anti-hardcoding gate"
status: "Approved"
date: "2026-08-07"
related_change_set: "WEB-I18N-FOUNDATION I18N-B"
---

# ADR-0004 – WEB-I18N-FOUNDATION I18N-B: locale model implementation, presentationLocale wiring and anti-hardcoding gate

## Context

I18N-A (`quest-city-roblox`, commit `ec1c4093d1c38ff477960cd7e7b0b7dc406af9d0`) registered the canonical
locale model: `02_34 v1.0` (Quest City Locale Model and Localization Foundation), the additive
`contracts/quest-city-platform-openapi-v1_5.yaml` (`presentationLocale` on `launch-context`), `02_26 v1.7`
§18.2, `07_15_01 v1.2` §15.2-bis, and `AGENTS.md v4.31` §4.21 decision D4. This ADR records the concrete
implementation choices I18N-B made to realize that contract in `quest-city-web`, none of which were fully
determined by the canonical documents:

- How the locale resolution hierarchy (student → class → school → platform) is represented as a pure,
  testable function when only the school level has a persisted source in this milestone.
- How `presentationLocale`'s three request behaviours (absent / valid-but-unsupported / malformed) are wired
  into the existing `launch-context` route without touching attempt technical provenance or any
  scoring/outcome code path.
- How `t()` and the it-IT catalogs are structured so a future second locale is additive, not a rewrite.
- How `ErrorEnvelope.message` is kept out of direct UI rendering without modifying the shared
  `ErrorEnvelope`/`IdentityError`/`CrossRuntimeError` types used by every other route.
- How the anti-hardcoding gate detects a real violation with an acceptable false-positive rate at this
  milestone's scale, without a full JSX/AST parser dependency.
- What is explicitly deferred: any translation beyond it-IT, student/class-level locale persistence,
  server-side `Accept-Language` translation, and any UI for editing locale preferences.

## Decision

### `packages/i18n` — locale model, resolver, translate, formatters

New workspace package, no dependency on any app so it can be consumed by `apps/api`, `apps/student-web` and
`apps/dashboard` alike:

- `locale-model.ts` — `DEFAULT_LOCALE = "it-IT"`, `SUPPORTED_LOCALES = ["it-IT"]`, `PLANNED_LOCALES`
  (`en-GB`, `en-US`, `es-ES`, `fr-FR`, `de-DE`), the restricted BCP-47-shaped pattern (same regex as
  `contracts/quest-city-platform-openapi-v1_5.yaml`'s `PresentationLocaleInput`), and `isSupportedLocale`/
  `isPlannedLocale`/`isSyntacticallyValidLocale` guards.
- `resolver.ts` — `resolveLocaleHierarchy({studentLocale, classLocale, schoolLocale})`, pure, always
  terminates at `DEFAULT_LOCALE`; `validatePresentationLocaleInput()` classifies a raw request value into
  exactly the four cases (`ABSENT`/`MALFORMED`/`VALID_SUPPORTED`/`VALID_UNSUPPORTED`) that 02_34 §4 and
  07_15_01 v1.2 §15.2-bis define; `resolvePresentationLocale()` composes both into the launch-context
  contract's three externally-visible behaviours.
- `translate.ts` — `t(catalog, key, {params, onMissingKey})`, a pure dot-path lookup with `{param}`
  interpolation. Missing-key behaviour is explicit and caller-controlled: defaults to `"throw"` outside
  `NODE_ENV=production` (loud during development) and `"returnKey"` in production (a missing key renders as
  its own key string, never a blank space, never a crash for a student). `translateErrorCode()` is the
  `errors.json`-specific wrapper, always `"returnKey"` on miss so an unmapped error code degrades to
  displaying the code itself rather than throwing in a request-handling path.
- `formatters.ts` — thin `Intl.DateTimeFormat`/`Intl.NumberFormat` wrappers (`formatDate`, `formatNumber`,
  `formatPercent`). No currency formatter: no monetary value exists anywhere in the current domain model, so
  adding one now would be an artificial use case (mandate: "senza introdurre ancora casi d'uso artificiali").
- `src/locales/it-IT/{common,student-web,dashboard,errors}.json` — the only populated catalogs. Markup is
  never embedded in a catalog string: a sentence that originally wrapped a route in `<code>` (e.g. "the `/w`
  route is live") is split into `...Before`/`...After` keys and the `<code>` element is written directly in
  JSX between two `t()` calls, so translators only ever see plain text and the DOM structure a screen-reader
  or CSS rule depends on cannot be broken by a catalog edit.

### `presentationLocale` wired into `launch-context`, not into attempt provenance

`apps/api/app/assignments/[assignmentId]/launch-context/route.ts` gained a `presentationLocale` optional
body field. Syntax validation runs immediately after `runtimeChannel` validation, before the session/tenant
lookup that would otherwise be wasted work on a doomed request — a malformed value returns `400
VALIDATION_ERROR` (domain `PLATFORM`, `safeDetails.field: "presentationLocale"`) inline, matching the
existing inline-`NextResponse.json` pattern this same file already uses for `404 RESOURCE_NOT_FOUND` (chosen
over extending the shared `IdentityError` class, which every other identity-error call site also depends on
— this keeps the blast radius to one file). The final resolved value is computed after the tenant is loaded
(a new `getTenantRepository()` in `apps/api/lib/identity-context.ts`, reusing the pre-existing
`TenantRepository` built for WEB-M1) and is always present in the `200` response as
`data.presentationLocale`.

`presentationLocale` is **not** added to `learning_attempt`'s technical-provenance columns (`07_15_01` §6.1/
§9, unchanged) and is never passed into `AttemptConsolidationService.consolidate()` — that method's input
type has no locale field at all, which is the structural guarantee behind the "same attempt, different
locale, same outcome" invariant, verified with a real-Postgres integration test that runs the identical
Balance Machine actions through two attempts resolved with different `presentationLocale` values and asserts
byte-identical `outcome`/`completionStatus`.

### Error localization: `code` is the only stable contract, `message` never reaches the UI directly

`translateErrorCode(ERRORS_CATALOG_IT_IT, code)` is the mapping utility 02_34 §6 requires. It is deliberately
built and fully tested in `packages/i18n` now, ready for any error-rendering surface — none exists yet in
`apps/student-web`/`apps/dashboard` (both remain WEB-M0 placeholder shells with no API calls), so no UI
component consumes it yet. Building a consumer component with nothing to render would itself be exactly the
kind of speculative, unused code this repository's own engineering standards ask agents to avoid; the utility
is the foundation deliverable, wiring it into a real screen happens when that screen exists.

### `lang` sourced from the locale model, not hardcoded — dynamic per-request resolution DEFERRED

`apps/student-web/app/layout.tsx` and `apps/dashboard/app/layout.tsx` previously hardcoded `lang="en"` while
serving Italian-market placeholder content — a pre-existing mismatch, not introduced here. Both now use
`lang={DEFAULT_LOCALE}` and `metadata.title`/`metadata.description` sourced from `t()`.

**This is an accepted, deliberate limitation of this foundation, not an oversight**, formalized as three
explicit statements:

1. **Dynamic per-request `lang` resolution is DEFERRED.** No page-locale routing, no locale cookie, no
   `Accept-Language` negotiation, and no per-page resolution of the student/class/school hierarchy for
   server-rendered `lang`/`metadata` are implemented in this milestone — none of that machinery would do
   anything useful yet, since `it-IT` is the only locale with a populated catalog.
2. **It will be introduced when at least a second locale is promoted from `plannedLocales` to
   `SUPPORTED_LOCALES`** (`packages/i18n/src/locale-model.ts`) — i.e., when a real second catalog exists to
   resolve *to*. Building per-request resolution before that point would be speculative code with no
   observable effect, which this repository's own engineering standards ask agents to avoid.
3. **Until then, `DEFAULT_LOCALE = "it-IT"` is the canonical, unconditional behaviour** for every
   server-rendered page in `apps/student-web` and `apps/dashboard` — not a placeholder pending a follow-up,
   the correct behaviour for a single-locale deployment.

### Anti-hardcoding gate: line-based heuristic, not a JSX/AST parser

`tools/check-i18n-strings.mjs` follows the same pragmatic, dependency-free pattern as the pre-existing
`tools/check-fixture-isolation.mjs`: a JSX-text-node regex (`>TEXT<` where `TEXT` contains no `{`/`}`, so a
`{t(...)}` expression child is automatically excluded) plus a `title`/`description` literal-string check for
`metadata` objects. False positives are suppressed by shape, not by a maintained exception list: a leading
`/` (route path), an `ENUM_LIKE`/error-code token, or a bare expression wrapper are all skipped. This is a
foundation-scale scanner, not a substitute for code review — documented explicitly in the tool's own header
comment and here. Verified against the real repository (zero violations) and against six fixture cases (three
negative — hardcoded JSX text, hardcoded `metadata.title`, a `*.test.tsx` file skipped — and three
false-positive guards — route path, enum token, `t()` expression).

## Consequences

- A second locale can be added by populating a new `src/locales/<locale>/*.json` directory and adding the
  locale to `SUPPORTED_LOCALES` — no resolver, `t()`, or route code changes, by construction.
- `presentationLocale` carries zero coupling to scoring/outcome/mastery; a future change to the locale model
  cannot silently affect assessment correctness because the consolidation service's type signature has no
  locale parameter to smuggle one through.
- The anti-hardcoding gate will need a real JSX/AST parser if the UI surface grows complex nesting or
  multi-line text patterns beyond this milestone's placeholder shells — tracked as a known limit, not solved
  here.
- `apps/api`'s non-browser-facing placeholder page (`app/page.tsx`, `app/layout.tsx`) was deliberately left
  untouched: it is explicitly out of scope per the I18N-B mandate (only `apps/student-web` and
  `apps/dashboard`), and per the WEB-I18N-FOUNDATION discovery report's own priority ranking (lowest i18n
  priority, not browser-facing).

## Known residual items (explicitly deferred, not silently dropped)

1. Student/class-level locale persistence — schema and UI both deferred; `resolveLocaleHierarchy` already
   accepts `studentLocale`/`classLocale` inputs so no resolver change will be needed when they arrive.
2. **Real per-request `lang`/page-locale resolution is DEFERRED** (no routing, no locale cookie, no
   `Accept-Language` negotiation, no per-page hierarchy resolution) — `apps/student-web` and
   `apps/dashboard` render with `DEFAULT_LOCALE = "it-IT"` unconditionally today, which is the canonical,
   correct behaviour for as long as `it-IT` is the only entry in `SUPPORTED_LOCALES`. This item graduates
   from "deferred" to "in scope" exactly when a second locale is promoted from `plannedLocales` to
   `SUPPORTED_LOCALES` — not before, and not as a standalone "make lang dynamic" task in the meantime.
3. Any translation beyond it-IT, any AI-assisted translation pipeline, any human review workflow.
4. Server-side `Accept-Language`-based translation of `ErrorEnvelope.message` — explicitly out of scope per
   02_34 §6 and this milestone's mandate.
5. A UI component that actually renders `translateErrorCode()` output — the mapping utility exists and is
   tested; no screen in this repository calls an API and displays an error yet.
6. `tools/check-i18n-strings.mjs` is an accepted **best-effort heuristic** for this foundation, not a
   full JSX/AST parser — it does not parse multi-line JSX text nodes split across several lines without an
   intervening tag, and does not inspect JSX attribute string values (deliberately, since those are
   overwhelmingly technical/enum values, not student-facing copy, at this milestone's scale). It is covered
   by its own test suite (`tools/check-i18n-strings.test.mjs`: one positive assertion against the real
   repository plus five negative/false-positive-guard fixtures) and wired into CI as a real, enforced gate —
   best-effort in coverage, not in enforcement.
