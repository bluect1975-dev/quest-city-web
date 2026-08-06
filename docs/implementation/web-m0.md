# WEB-M0 — Repository Discovery, Bootstrap and Foundation

## Apps and packages manifest (deliverable 28)

| App/Package | Purpose | WEB-M0 scope |
|---|---|---|
| `apps/student-web` | Web Student Experience shell | `/w` placeholder route only, no lesson/activity content, no auth |
| `apps/dashboard` | Shared school/teacher dashboard shell | `/dashboard` placeholder route only; one shared dashboard, never duplicated |
| `apps/api` | Platform API seed | `/health/live`, `/health/ready` only; domain services are IMPLEMENT_LATER, consumed from the shared Platform API model (`02_25 §4`), not reimplemented |
| `packages/contracts` | Shared OpenAPI contract | Vendored, checksum-verified snapshot of `quest-city-roblox`'s `contracts/quest-city-platform-openapi-v1_2.yaml`; not forked or redefined |
| `packages/content-schema` | Fixture-stage JSON Schemas | The 8 schemas listed in `07_09 §26`; no production content schema (none exists upstream yet — `02_14` defers that to `02_19`) |
| `packages/content-runtime` | Bundle manifest loader | Validates a manifest and rejects anything but `RUNTIME_FIXTURE_BUNDLE` at this milestone |
| `packages/learning-engines` | Engine registry | Registry mechanism only; zero engines registered (Step 5, `07_10 §28`, is IMPLEMENT_LATER) |
| `packages/theme-system` | Theme Package contract | `QC-THEME-CORE` fallback only (`07_01_02 §6`); `QC-THEME-ACADEMY` is IMPLEMENT_LATER |
| `packages/ui` | Shared UI primitives | `Button`, `StatusMessage` — the minimum needed by the two placeholder apps |
| `packages/telemetry` | Structured logging | Correlation-ID JSON logger (`07_05 §14`, deliverable 18) |
| `packages/config` | Shared tooling config | ESLint flat config, Prettier, base `tsconfig`, base Vitest config |
| `packages/test-fixtures` | Technical fixtures | Balance Machine `RUNTIME_FIXTURE_BUNDLE` (`07_09 §25`) — technical only, not M06 content |
| `tools` | Repository tooling | `migrate.mjs`, `check-duplicates.mjs`, `check-filenames.mjs` |
| `tests/integration` | Integration tests | Health-endpoint and route-reachability tests against the docker-compose environment |

## Scope record

**In scope (per the approved WEB-M0 change set):** repository bootstrap, monorepo configuration, TypeScript strict, minimal student-web/dashboard/api apps, health endpoints, `/w` and `/dashboard` placeholders, validated environment configuration, `.env.example`, per-app containers, local orchestration, local PostgreSQL, verifiable migration structure, structured logging with correlation ID, lint, type check, minimal unit tests, health-endpoint integration test, reproducible build, CI workflow, bootstrap/verify scripts, ADR for the reverse-proxy decision, apps/packages manifest.

**Out of scope (explicitly, per the approved change set):** the M06 vertical slice, SpriteCook asset generation, local reward/mastery logic, a duplicate dashboard, a separate database for Web vs. Roblox, direct browser-to-PostgreSQL access, secrets in the repository, persistent tokens in `localStorage`, a separate Web curriculum, manually copied M06 lessons, browser-only validators, arbitrary code in content bundles, definitive login systems, any modification to `quest-city-roblox`.

## Key upstream decisions this milestone relies on

- `ADR-0005` (`quest-city-roblox`) — Controlled Multi-Repository Architecture: authorizes this repository as an autonomous Git root.
- `05_01 v2.0` (`quest-city-roblox`) — repository/package tree, toolchain (pnpm, TypeScript strict, Next.js App Router, Vitest, Playwright, OCI containers), quality gates.
- `07_05 v1.1` (`quest-city-roblox`) — Web runtime technical architecture; defers repository structure to `05_01 v2.0 §5`.
- `07_03` (`quest-city-roblox`) — confirms `/w` as the canonical Web root namespace.
- `07_06` (`quest-city-roblox`) — VPS topology (`/w`, `/dashboard`, `/api` behind one reverse proxy), PostgreSQL never publicly reachable; leaves the exact reverse-proxy tool to an ADR (resolved here as `docs/adr/0001-reverse-proxy-nginx.md`).
- `07_09 §25-26` (`quest-city-roblox`) — fixture-only content bundle scope and the 8 fixture-stage schema names.
