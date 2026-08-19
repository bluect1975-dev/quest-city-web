# Quest City Web

Web runtime channel of Quest City. This is **not** an independent didactic product — it shares curriculum, lesson/activity definitions, validators, evidence, outcome, mastery, scoring, reward, recovery, student profile, classes, assignments, dashboard, backend and database with the Roblox runtime (`quest-city-roblox`). Differences between the Web and Roblox runtimes stay confined to the runtime adapter, presentation adapter, engine adapter, Theme Package and runtime-specific assets (`07_01`, `07_08`).

This repository is an autonomous Git repository, sibling to `quest-city-roblox` in the local `questcity/` workspace, per `ADR-0005` (Controlled Multi-Repository Architecture, `quest-city-roblox`) and this repository's own `05_01 v2.0`.

## Milestones

- **WEB-M0** — repository bootstrap (`05_02 v1.3`): a working monorepo skeleton, health endpoints, placeholder routes, local orchestration, CI, and the tooling needed to build on top of. See `docs/implementation/web-m0.md`.
- **WEB-M1 Fase 2** — canonical student identity/enrollment (`02_25 §6.1/§6.10/§6.11`, `02_26 §30`): class-code + alias + PIN login, `HttpOnly`/`Secure`/`SameSite=Lax` sessions with full rotation, synchronizer-token CSRF, `FIXED_WINDOW` rate limiting, HMAC-SHA-256 class-code hashing, audit logging, and the administrative offline seed. See `docs/implementation/web-m1-phase2.md` and `docs/adr/0002-web-m1-identity-session-design.md`.

See `docs/adr/` for the technical decisions made along the way and `docs/implementation/` for milestone-specific notes (each milestone's own file lists exactly which files it created or extended — this README describes the repository as it stands today, across all landed milestones).

## Repository layout

```text
apps/
├── student-web/   Web Student Experience shell — route /w
├── dashboard/     Shared school/teacher dashboard shell — route /dashboard
└── api/           Platform API seed — /health/live, /health/ready at WEB-M0
packages/
├── contracts/         Vendored, checksum-verified OpenAPI contract (quest-city-roblox is the source of truth)
├── content-schema/    Fixture-stage JSON Schemas (07_09 §26) + ajv-based validation
├── content-runtime/   Bundle manifest loader/validator
├── learning-engines/  Engine registry contract — no engine implemented yet
├── theme-system/      Theme Package contract + QC-THEME-CORE fallback
├── ui/                Shared accessible UI primitives (Button, StatusMessage)
├── telemetry/         Structured JSON logging with correlation ID
├── config/            Shared ESLint/Prettier/TypeScript/Vitest base config
└── test-fixtures/     Technical fixtures (Balance Machine RUNTIME_FIXTURE_BUNDLE)
infrastructure/
├── containers/      Per-app Dockerfiles (OCI, multi-stage, Next.js standalone output)
├── reverse-proxy/   Nginx config (ADR-0001)
├── database/        Migrations (forward-only SQL) + local Postgres data volume
├── deployment/       docker-compose.yml for local/orchestrated environment
└── scripts/          bootstrap.sh, verify.sh
docs/
├── adr/             Architecture decision records for this repository
├── runbooks/        Operational runbooks (populated as they're needed)
└── implementation/  Milestone implementation notes
tools/               migrate.mjs, check-duplicates.mjs, check-filenames.mjs
tests/
├── unit/            (unit tests are co-located per-package — see tests/unit/README.md)
├── integration/     Health-endpoint integration tests against docker compose
├── contract/        IMPLEMENT_LATER
├── e2e/             IMPLEMENT_LATER
└── fixtures/        Points to packages/test-fixtures
```

## Prerequisites

- Node.js `24.x` (see `.nvmrc`) — Active LTS at the time of writing.
- `pnpm` `>=9` (this repo pins `pnpm@11.2.2` via `packageManager` — `corepack enable` picks it up automatically).
- Docker with Compose v2 (`docker compose`, not the legacy `docker-compose`).

## Quick start (single documented procedure)

```bash
bash infrastructure/scripts/bootstrap.sh
```

This copies `.env.example` to `.env` (if absent), installs dependencies, builds and starts the local environment (Postgres, api, student-web, dashboard, Nginx), waits for the API to become healthy, and runs pending database migrations. On success:

- Student Web: <http://localhost:8080/w>
- Dashboard: <http://localhost:8080/dashboard>
- API health: <http://localhost:8080/api/health/live>, <http://localhost:8080/api/health/ready>

Stop the environment with:

```bash
docker compose -f infrastructure/deployment/docker-compose.yml down
```

## Verification

```bash
bash infrastructure/scripts/verify.sh                  # lint, typecheck, unit tests, build
bash infrastructure/scripts/verify.sh --with-integration  # + docker compose + health-endpoint integration tests
```

Or individually:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:duplicates
pnpm run check:filenames
```

## Environment variables

See `.env.example` — copy it to `.env` and adjust for your environment. No secret ever belongs in a committed file; `.env` is gitignored. Production secrets are provisioned through the VPS secret store described in `07_06 §9` (in `quest-city-roblox`), never committed here.

One variable has no default in `.env.example` and must be set explicitly before `apps/api` or `tools/seed-pilot.ts` will even start, in every environment including local development: `CLASS_CODE_HASH_PEPPER` (HMAC-SHA-256 key for class-code hashing, ≥ 32 bytes base64 — see `docs/adr/0002-web-m1-identity-session-design.md`). Generate a local value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Telegram alert channel (Master Admin Operations Control Center)

`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are optional and empty by default in `.env.example`. `apps/api/lib/operations-context.ts` selects `TelegramAlertChannelAdapter` only when both are set, falling back to `LocalMockAlertChannelAdapter` otherwise — no Telegram account is ever required for local development or CI. They are read only by `apps/api` (never `dashboard`, `student-web`, or `nginx`; never a `NEXT_PUBLIC_*` variable), and the Bot Token value itself is never persisted to the database, logged, or returned by any API response — only `alert_configuration.credential_ref` (the literal string `TELEGRAM_BOT_TOKEN`, a pointer to the secret's env-var name) and a masked `recipient_ref` are stored.

Set both (never just one) via the secret store (`07_06 §9`) in staging/production. `bash infrastructure/scripts/bootstrap.sh` provisions `alert_configuration` automatically and idempotently from these two variables after migrations run — no manual `UPDATE` is ever required. To run provisioning standalone:

```bash
DATABASE_URL=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  pnpm --filter @quest-city-web/tools run provision:telegram-alert-channel
```

Provisioning only ever writes `recipient_ref`/`credential_ref` — a PLATFORM_ADMIN's `enabled`/severity threshold/cooldown choices made via the Control Center UI are never overwritten by a re-run. Enabling real delivery for the first time still requires an explicit PLATFORM_ADMIN opt-in in the UI (the channel row is created with `enabled=false` by default).

## Database migrations

Forward-only SQL migrations live in `infrastructure/database/migrations/` (`NNNN_description.sql`, with a matching `NNNN_description.rollback.sql`). Apply pending migrations with:

```bash
DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5434/quest_city_web \
  pnpm --filter @quest-city-web/tools run migrate
```

PostgreSQL is bound to `127.0.0.1` only, both locally and (per `07_06`) on the VPS — never to a public interface, and the browser never talks to it directly; all data access goes through `apps/api`. Locally it's published on host port `5434` (not the default `5432`) to avoid colliding with PostgreSQL instances you may already have running natively.

Migrations applied so far: `0001_init_extensions` (pgcrypto), `0002_canonical_identity_and_web_enrollment` (WEB-M1 Fase 2 — canonical `tenant`/`audit_event` plus class-code/enrollment/session tables).

## Administrative seed (WEB-M1 Fase 2)

Tenant, class, student profile and enrollment provisioning happens exclusively through a controlled offline administrative script — no public API endpoint creates a profile or enrollment (`02_25 §6.11`):

```bash
DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5434/quest_city_web \
CLASS_CODE_HASH_PEPPER=<your-local-pepper> \
  pnpm --filter @quest-city-web/tools run seed -- --out <path-outside-this-repo> [--students N]
```

`--out` is required (no default), must resolve outside this repository's Git root, and the script refuses to overwrite an existing file. The generated class code, aliases and PINs are written only to that file (`0600` permissions where the filesystem supports it) — never to stdout, stderr or any log. Hand the file to the authorized school administrator, then delete it manually.

## Shared contracts and content

This repository does not redefine curriculum, schemas or the platform API contract — it consumes them. `packages/contracts/vendor/` holds a checksum-verified, provenance-tracked snapshot of `quest-city-roblox`'s `contracts/quest-city-platform-openapi-v1_2.yaml` (see `packages/contracts/vendor/provenance.json` for the re-sync procedure). `packages/content-schema` holds only the fixture-stage schemas needed to validate a `RUNTIME_FIXTURE_BUNDLE` (`07_09 §26`) — no production curriculum schema is defined in this repository.

## Governing documentation

The authoritative specifications for this repository live in `quest-city-roblox` (read-only from here): `AGENTS.md`, `docs/00-governance/`, `docs/02-shared-platform/`, `docs/05-engineering-execution/`, `docs/07-web-learing-platform/`, and `docs/adr/ADR-0005`. This repository's own `docs/adr/` records decisions specific to `quest-city-web` itself (e.g. reverse-proxy choice).

## Out of scope

Per the approved change sets to date: WEB-M2 (content bundle loader, attempt lifecycle, semantic action, outcome, validator fixture), the M06 vertical slice, SpriteCook asset generation, local reward/mastery logic, a duplicate dashboard, a separate database for Web vs. Roblox, direct browser-to-Postgres access, secrets in the repository, persistent tokens in `localStorage`, a separate Web curriculum, Roblox linking, magic link, federated login. See `docs/implementation/web-m0.md` and `docs/implementation/web-m1-phase2.md` for each milestone's full scope record — a milestone's own "out of scope" list reflects what was out of scope *for that milestone specifically*, not necessarily for the repository going forward (e.g. "no login system" was true at WEB-M0 and is no longer true since WEB-M1 Fase 2).
