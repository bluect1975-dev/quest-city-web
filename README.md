# Quest City Web

Web runtime channel of Quest City. This is **not** an independent didactic product — it shares curriculum, lesson/activity definitions, validators, evidence, outcome, mastery, scoring, reward, recovery, student profile, classes, assignments, dashboard, backend and database with the Roblox runtime (`quest-city-roblox`). Differences between the Web and Roblox runtimes stay confined to the runtime adapter, presentation adapter, engine adapter, Theme Package and runtime-specific assets (`07_01`, `07_08`).

This repository is an autonomous Git repository, sibling to `quest-city-roblox` in the local `questcity/` workspace, per `ADR-0005` (Controlled Multi-Repository Architecture, `quest-city-roblox`) and this repository's own `05_01 v2.0`.

## Current milestone: WEB-M0

WEB-M0 is the repository bootstrap milestone (`05_02 v1.3`): a working monorepo skeleton, health endpoints, placeholder routes, local orchestration, CI, and the tooling needed to build on top of — no real curriculum content, no vertical slice, no production authentication. See `docs/adr/` for the technical decisions made along the way and `docs/implementation/` for milestone-specific notes.

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

## Database migrations

Forward-only SQL migrations live in `infrastructure/database/migrations/` (`NNNN_description.sql`, with a matching `NNNN_description.rollback.sql`). Apply pending migrations with:

```bash
DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5434/quest_city_web \
  pnpm --filter @quest-city-web/tools run migrate
```

PostgreSQL is bound to `127.0.0.1` only, both locally and (per `07_06`) on the VPS — never to a public interface, and the browser never talks to it directly; all data access goes through `apps/api`. Locally it's published on host port `5434` (not the default `5432`) to avoid colliding with PostgreSQL instances you may already have running natively.

## Shared contracts and content

This repository does not redefine curriculum, schemas or the platform API contract — it consumes them. `packages/contracts/vendor/` holds a checksum-verified, provenance-tracked snapshot of `quest-city-roblox`'s `contracts/quest-city-platform-openapi-v1_2.yaml` (see `packages/contracts/vendor/provenance.json` for the re-sync procedure). `packages/content-schema` holds only the fixture-stage schemas needed to validate a `RUNTIME_FIXTURE_BUNDLE` (`07_09 §26`) — no production curriculum schema is defined in this repository.

## Governing documentation

The authoritative specifications for this repository live in `quest-city-roblox` (read-only from here): `AGENTS.md`, `docs/00-governance/`, `docs/02-shared-platform/`, `docs/05-engineering-execution/`, `docs/07-web-learing-platform/`, and `docs/adr/ADR-0005`. This repository's own `docs/adr/` records decisions specific to `quest-city-web` itself (e.g. reverse-proxy choice).

## Out of scope at WEB-M0

Per the approved change-set scope: the M06 vertical slice, SpriteCook asset generation, local reward/mastery logic, a duplicate dashboard, a separate database for Web vs. Roblox, direct browser-to-Postgres access, secrets in the repository, persistent tokens in `localStorage`, a separate Web curriculum, definitive login systems. See `docs/implementation/web-m0.md` for the full scope record.
