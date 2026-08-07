# WEB-I18N-FOUNDATION — Locale Model Foundation (I18N-A + I18N-B)

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Contracts | `packages/contracts/vendor/quest-city-platform-openapi-v1_5.yaml` (+ `provenance-v1_5.json`) | Vendored, checksum-verified v1.5 OpenAPI additive artifact (source: `quest-city-roblox` commit `ec1c4093`) — adds `presentationLocale` to `LaunchContextRequest`/`LaunchContextResponse.data` only |
| Package (new) | `packages/i18n` | `locale-model.ts` (`DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `PLANNED_LOCALES`, BCP-47-shaped pattern), `resolver.ts` (`resolveLocaleHierarchy`, `validatePresentationLocaleInput`, `resolvePresentationLocale`), `translate.ts` (`t()`, `translateErrorCode()`), `formatters.ts` (`formatDate`/`formatNumber`/`formatPercent`), `catalogs.ts` + `src/locales/it-IT/{common,student-web,dashboard,errors}.json` |
| API lib (extended) | `apps/api/lib/identity-context.ts` | `getTenantRepository()` — reuses the pre-existing WEB-M1 `TenantRepository` to read `tenant.settings_json.locale` for the school-level hierarchy input |
| API (extended) | `apps/api/app/assignments/[assignmentId]/launch-context/route.ts` | `presentationLocale` request field, inline `400 VALIDATION_ERROR` for a malformed value (before any attempt state mutation), `data.presentationLocale` in the response |
| UI (extended) | `apps/student-web/app/layout.tsx`, `apps/student-web/app/w/page.tsx`, `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/dashboard/page.tsx` | `lang={DEFAULT_LOCALE}` (was hardcoded `lang="en"`), all placeholder UI text sourced from the it-IT catalog via `t()` |
| Tooling (new) | `tools/check-i18n-strings.mjs` (+ `.test.mjs`) | Anti-hardcoding gate for `apps/student-web`/`apps/dashboard`; `check:i18n-strings` script |
| CI | `.github/workflows/ci.yml`, `infrastructure/scripts/verify.sh`, `package.json` | `i18n anti-hardcoding check` step wired alongside the existing filename/duplicate/fixture-isolation checks |
| Tests (extended) | `tests/integration/attempt-lifecycle.test.ts` | `presentationLocale` resolution against a real `tenant.settings_json.locale` row (absent/valid-supported/valid-unsupported/malformed), and the same-outcome-under-different-locale invariant |
| Governance | `docs/adr/0004-web-i18n-foundation-locale-model.md` | Local ADR for the decisions listed there |
| Register | `tools/duplicate-check-allowlist.txt` | `packages/i18n/{tsconfig.json,vitest.config.ts}` joined the existing shared-boilerplate groups |

## Scope record

**In scope:** canonical locale model implementation (`supportedLocales` = [`it-IT`], `plannedLocales`
registered but never reported as supported), locale resolution hierarchy (student/class reserved inputs,
school reads a real persisted value, platform default always terminates the chain), `presentationLocale`'s
three request behaviours wired into `launch-context` exactly as specified by `07_15_01 v1.2` §15.2-bis,
`t()`/interpolation/missing-key handling, `it-IT` catalogs for `apps/student-web` and `apps/dashboard`,
`Intl` formatting helpers (date/number/percent, no currency), the `code → errors.json` mapping utility, an
anti-hardcoding CI gate with positive and negative tests, this ADR and implementation doc.

**Out of scope (explicitly, per this change set's authorization and `docs/adr/0004`):** any translation other
than it-IT (`en-GB`/`en-US`/`es-ES`/`fr-FR`/`de-DE` remain `plannedLocales` only), AI translation pipelines,
a translation editor or human review workflow, foreign curricula localization, any modification to the
Roblox runtime, WEB-M3, student/class-level locale persistence, real per-request page-locale resolution
(`lang` is currently always `DEFAULT_LOCALE`), server-side `Accept-Language` translation of
`ErrorEnvelope.message`, and any UI component that renders `translateErrorCode()` output (no error-displaying
screen exists yet in `apps/student-web`/`apps/dashboard` to wire it into).

## Key upstream decisions this milestone relies on

- `02_34 v1.0` (`quest-city-roblox`) — canonical locale model: BCP-47, `supportedLocales`/`plannedLocales`,
  resolution hierarchy, `presentationLocale` contract, `ErrorEnvelope` localization policy, asset policy.
- `contracts/quest-city-platform-openapi-v1_5.yaml` (source commit `ec1c4093`) — additive to v1.4; the exact
  shape of `PresentationLocaleInput` (the restricted BCP-47 pattern reused verbatim in `packages/i18n`).
- `07_15_01 v1.2` §15.2-bis — the exact three-behaviour table (absent/valid-unsupported/malformed) this
  milestone's `resolvePresentationLocale()` implements one-to-one.
- `02_26 v1.7` §18.2 — `presentationLocale` documented on the `launch-context` request/response surface only;
  confirms it is not part of attempt technical provenance (§18.6, unchanged).
- `AGENTS.md v4.31` §4.21 rule 20, decision D4 — the binding invariant that `presentationLocale` never
  influences outcome/scoring/attemptState/completionStatus/mastery/validator/semantic actions, and the
  I18N-A/I18N-B phase sequencing (same pattern as WEB-M2A/WEB-M2B, D3).
- `docs/adr/0003` (WEB-M2B) — `ErrorEnvelope` shape and the `AttemptConsolidationService.consolidate()`
  contract this milestone deliberately does not extend with a locale parameter.

## Known residual items

See `docs/adr/0004-web-i18n-foundation-locale-model.md`, "Known residual items" — repeated here for a
single point of reference:

1. Student/class-level locale persistence — deferred; the resolver's input shape already anticipates it.
2. **Real per-request `lang`/page-locale resolution is DEFERRED** — no routing, no locale cookie, no
   `Accept-Language` negotiation. `apps/student-web`/`apps/dashboard` render with `DEFAULT_LOCALE = "it-IT"`
   unconditionally today, which is the canonical, correct behaviour while `it-IT` remains the only entry in
   `SUPPORTED_LOCALES`. This is introduced when — and only when — a second locale is promoted from
   `plannedLocales` to `SUPPORTED_LOCALES`, not as a standalone task before that.
3. Any translation beyond it-IT; no AI translation pipeline; no human review workflow.
4. Server-side `Accept-Language` translation of `ErrorEnvelope.message` — explicitly out of scope.
5. No UI component renders `translateErrorCode()` yet — the mapping utility exists and is tested.
6. `tools/check-i18n-strings.mjs` is an accepted **best-effort heuristic** for this foundation, not a
   JSX/AST parser — does not handle multi-line JSX text nodes split across lines without an intervening tag,
   and does not inspect JSX attribute string values (deliberate: those are overwhelmingly technical/enum
   values at this scale). Covered by its own test suite and enforced as a real CI gate.
