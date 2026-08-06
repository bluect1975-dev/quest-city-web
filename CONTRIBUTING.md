# Contributing

## Workflow

- Branch names: `main` (protected), `feature/<ticket>-<slug>`, `fix/<ticket>-<slug>`, `docs/<slug>`, `release/<version>` (`05_01 §9`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `05_01 §9`).
- Every change lands via pull request with green CI; no force-push to `main`.

## Before opening a pull request

```bash
bash infrastructure/scripts/verify.sh
```

This runs the filename/duplicate checks, lint, type check, unit tests and build across every package — the same checks CI runs. Add `--with-integration` to also exercise the docker-compose environment and the health-endpoint integration tests.

## Code style

- TypeScript strict everywhere (`tsconfig.base.json`).
- camelCase / PascalCase for TypeScript identifiers and components; UPPER_SNAKE_CASE for constants (`05_01` code style).
- Shared lint/format config lives in `packages/config` — do not fork it per-package without a reason documented in a PR description.

## Scope discipline

This repository shares curriculum, validators, mastery, scoring, reward, recovery, student profile, classes, assignments, dashboard, backend and database with `quest-city-roblox`. Differences must stay confined to runtime adapter / presentation adapter / engine adapter / Theme Package / runtime-specific assets (`07_01`, `07_08`). If a change would duplicate curriculum, the dashboard, or the database, stop and raise it instead of implementing it — see `docs/adr/` for how prior technical decisions were recorded and follow the same pattern for new ones.

`quest-city-roblox` is read-only from this repository. Never commit to it from here.
