# Security

## Reporting

Report suspected security issues privately to the repository maintainers rather than opening a public issue. Do not include real student, teacher or school data in any report.

## Baseline controls at WEB-M0

- No secret is committed to this repository (`.env.example` contains placeholder names only; `.gitignore` excludes `.env*`; secret scanning runs in CI).
- No persistent session token is stored in `localStorage` (07_16, 02_07 §session rules) — sessions use `HttpOnly`, `Secure`, `SameSite` cookies once authentication is implemented (not at WEB-M0).
- PostgreSQL is never exposed on a public interface, locally or on the VPS (`07_06 §3/§4/§7`); it is bound to `127.0.0.1` locally and reachable from `apps/api` only over the internal Docker network.
- The browser never accesses PostgreSQL directly — all data access goes through `apps/api`.
- Dependency and secret scanning run in CI (`.github/workflows/ci.yml`).

## Out of scope at WEB-M0

Definitive authentication/authorization, CSRF protection, Content Security Policy and rate limiting are real requirements of `07_05 §8` but are not implemented at this bootstrap milestone, which ships no authenticated flow to protect. They are required before any pilot per `AGENTS.md §4.25` and `07_16`.
