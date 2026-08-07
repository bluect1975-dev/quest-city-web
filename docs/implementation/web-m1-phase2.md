# WEB-M1 Fase 2 — Canonical Identity, Session and Web Access

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Migration | `infrastructure/database/migrations/0002_canonical_identity_and_web_enrollment.sql` (+ `.rollback.sql`) | Canonical `tenant`/`audit_event` (§6.1/§6.10) + WEB-M1 `school_class`, `student_profile`, `class_access_code`, `school_enrollment`, `student_session`, `rate_limit_bucket` (§6.11) |
| Package | `packages/identity` | PIN hashing (scrypt), session/CSRF token hashing (SHA-256), class-code hashing (HMAC-SHA-256 + pepper), `FIXED_WINDOW` rate limiting, tenant-scoped repositories, `ClassCodeService`, `SessionService`, canonical error codes |
| API | `apps/api/app/web-auth/class-code/resolve`, `.../session/start`, `.../session/refresh`, `.../logout`, `apps/api/app/me/student-context` | The 5 WEB-M1 endpoints (`02_26 §30.1`) |
| API lib | `apps/api/lib/{identity-context,session-cookie,csrf-guard,identity-validation,identity-error-response,client-ip}.ts` | Wiring, cookie handling, CSRF/Origin guard, request validation, error envelope, client IP extraction |
| API lib (extended) | `apps/api/lib/env.ts` | New env vars: session TTLs, cookie name, trusted origins, dev-only Secure override, `CLASS_CODE_HASH_PEPPER` (required, no default) |
| API startup | `apps/api/instrumentation.ts` | Next.js `register()` hook — calls `loadEnv()` once at process boot so a missing/invalid `CLASS_CODE_HASH_PEPPER` (or any other required env var) fails startup, not the first request |
| Tooling | `tools/seed-pilot.ts` | Administrative offline pilot seed (`--out` required, no secrets in stdout/log) |
| Contracts | `packages/contracts/vendor/quest-city-platform-openapi-v1_3.yaml` (+ `provenance-v1_3.json`), `packages/contracts/src/index.ts` (extended) | Vendored, checksum-verified v1.3 OpenAPI additive artifact |
| Governance | `docs/adr/0002-web-m1-identity-session-design.md` | Local ADR for the parameters and decisions listed there |
| Env template | `.env.example` (extended) | New variables documented with defaults |

## Scope record

**In scope:** canonical `tenant`/`audit_event` implementation, WEB-M1 identity/enrollment tables, class-code + alias + PIN login, HMAC-SHA-256 class-code hashing keyed by a mandatory `CLASS_CODE_HASH_PEPPER`, `HttpOnly`/`Secure`/`SameSite=Lax` session cookie, synchronizer-token CSRF, `FIXED_WINDOW` rate limiting on 4 dimensions, full session rotation on refresh, idempotent logout, audit logging, `/me/student-context`, administrative offline seed, OpenAPI v1.3 vendoring + provenance, unit/integration/security tests.

**Out of scope (explicitly, per this change set's authorization):** WEB-M2 (content bundle loader, attempt lifecycle, semantic action, outcome, validator fixture), Roblox linking, magic link, federated login, administrative UI, reward, mastery, SpriteCook, M06, any modification to `quest-city-roblox`.

## Key upstream decisions this milestone relies on

- `00_01 v4.42` "Controlled update v4.42" — registers WEB-M1 as a two-phase change set; this document records Fase 2's execution.
- `02_25 v1.6 §6.11` — WEB-M1 identity/enrollment data model; `§6.1`/`§6.10` — canonical `tenant`/`audit_event`.
- `02_26 v1.5 §30` — WEB-M1 student access API contract.
- `AGENTS.md v4.28` "WEB-M1 implementation baseline" — binding security parameters (CSRF, rate limiting, session, pilot access method, anti-enumeration, provisioning).
- `07_16 v1.0` — narrative Step 8 specification; superseded on specific points (error codes, endpoint list) by `02_26 v1.5 §30`, per that document's own precedence rule.
- `ADR-0005`, `02_24 §22-23`, `05_01 §17` (`quest-city-roblox`) — canonical shared backend model; forbid database/schema duplication without a dedicated ADR.
- WEB-M1 Fase 2 correction report (2026-08-06) — binding corrections D5 (enum values), D6 (PIN hash format), D7 (rate-limit thresholds), exact scrypt parameters, token accessibility criteria, `Secure` cookie local/production policy.
- WEB-M1 Fase 2 second correction report (2026-08-06) — HMAC-SHA-256 class-code hashing with a mandatory, no-default `CLASS_CODE_HASH_PEPPER`; precise (non-symmetric) session-vs-CSRF token JavaScript-accessibility criteria; seed-script `0600` permission verified on a real Linux/POSIX filesystem.

## Known residual items

- File permission `0600` on the seed script's `--out` file, applied via `fs.chmod`, was verified to actually take effect (`-rw-------`, `mode=600`) on a real Linux/POSIX filesystem (`node:24-slim` — the same base image as `apps/api`'s production Dockerfile, i.e. the actual deployment target). On a Windows/NTFS host the same call is best-effort and the OS may not enforce it — a purely local-development caveat, not a production one; Windows-based operators running the seed locally should rely on filesystem/OS-level access control for that file in addition.
- `07_15_01` (cross-runtime dashboard/assignment specification) remains a registered-but-missing document; confirmed non-blocking for this milestone's login/session/enrollment scope (WEB-M2 discovery report and WEB-M1 Fase 2 discovery report both document this gap).
