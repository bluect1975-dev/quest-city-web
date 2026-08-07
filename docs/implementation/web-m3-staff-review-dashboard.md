# WEB-M3B — Staff Identity, Dashboard Review Queue, Teacher Feedback and Recovery Assignment

## Files created or extended

| Area | Path | Purpose |
|---|---|---|
| Contracts | `packages/contracts/vendor/quest-city-platform-openapi-v1_6.yaml` (+ `provenance-v1_6.json`) | Vendored, checksum-verified v1.6 OpenAPI additive artifact (source: `quest-city-roblox` commit `b8d28266`) — 18 staff-scoped paths |
| Migration (new) | `infrastructure/database/migrations/0004_staff_identity_and_review.sql` (+ `.rollback.sql`) | `staff_account`, `staff_tenant_membership`, `staff_class_assignment` (+ teacher-only trigger), `staff_session`, `review_queue_item` (+ partial unique index), `teacher_feedback`; `assignment.origin_type`/`target_student_profile_id`; `idempotency_record` scope-CHECK extension; 6 new indices |
| Package (new) | `packages/staff-identity` | 6 repositories (`StaffAccount`, `StaffTenantMembership`, `StaffClassAssignment`, `StaffSession`, `ReviewQueueItem`, `TeacherFeedback`), 4 services (`StaffAuthService`, `ReviewService`, `FeedbackService`, `RecoveryAssignmentService`), `crypto/password.ts` (self-contained scrypt), `errors.ts` (`StaffIdentityError`, 12 codes), `services/authorization.ts` (`assertClassInScope`/`isClassInScope`) |
| Package (extended) | `packages/identity` | `AuditActorType` gains `"STAFF"`; `SchoolClassRepository.findByTenant`/`findByIds`; `SchoolEnrollmentRepository.findByClass`/`findByClassAndStudent` |
| Package (extended) | `packages/attempts` | `IdempotencyRecordRepository`'s `scope` parameterized (was hardcoded `'attempt_completion'`); `LearningAttemptRepository.summarizeForClass`/`findByStudentProfile`; `AssignmentRepository`'s `originType`/`targetStudentProfileId` |
| Package (extended) | `packages/ui` | `Table`, `FormField`, `StatusBadge`, `EmptyState` |
| Package (extended) | `packages/i18n` | `dashboard.json`'s new `app.*` namespace (~130 keys: login/home/classes/review/attempt-review/status labels); `errors.json`'s 10 new staff codes; `common.json`'s `status.unauthorized` |
| API lib (new) | `apps/api/lib/staff-identity-context.ts`, `staff-request-context.ts`, `staff-error-response.ts`, `staff-session-cookie.ts`, `staff-csrf-guard.ts`, `staff-validation.ts` | Pool/service factories, `requireStaffIdentity()`, `StaffIdentityError` → `ErrorEnvelope` mapping, cookie helpers, request validation |
| API lib (extended) | `apps/api/lib/env.ts` | `staffSessionCookieName`, `staffSession{Absolute,Inactivity}TtlSeconds`, `staffAuthTrustedOrigins` |
| API (new) | 18 route files under `apps/api/app/{staff-auth,me/staff-context,classes,review,attempts,feedback}/**` | Full staff-auth, classes/roster/progress read, review queue, attempt review, teacher feedback, recovery assignment surface |
| Dashboard UI (new) | `apps/dashboard/app/app/**` (8 pages), `apps/dashboard/lib/{staff-api-client,staff-api-types,staff-api-error,staff-auth-context,staff-error-text,RequireStaffAuth,useAsync}.ts(x)` | Login, home, classes list/detail, student detail, review queue, attempt review + feedback + recovery assignment |
| Tooling (new) | `tools/seed-staff.ts` (+ `seed:staff` script) | Offline administrative staff provisioning, mirrors `tools/seed-pilot.ts`'s secret-handling discipline |
| Governance | `docs/adr/0005-web-m3-staff-review-dashboard.md` | Local ADR for the decisions listed there |
| Config | `.env.example` | `STAFF_SESSION_*`, `STAFF_AUTH_TRUSTED_ORIGINS` |

## Scope record

**In scope:** staff identity (email/password, self-contained scrypt, higher cost params than the student PIN),
tenant-scoped role resolution (`TEACHER` explicit class scope / `SCHOOL_ADMIN` implicit tenant-wide scope),
staff session lifecycle (start/refresh/logout, CSRF, fixed-window rate limiting, progressive lockout,
anti-enumeration), read-only classes/roster/progress/attempt-history composed from existing WEB-M1/WEB-M2
entities, review queue lifecycle (claim/release/resolve/dismiss/reopen via one parametric endpoint), attempt
review detail (composed, no invented data, `proposedAiFeedback` always `null`), teacher feedback
(create-DRAFT/publish/revoke, two-axis status model), recovery assignment (single narrowly-scoped write path
into the existing `assignment` entity), the 4 new `packages/ui` components, it-IT catalog extensions, the
staff seed script, this doc and ADR-0005.

**Out of scope (explicitly, per this change set's authorization and `docs/adr/0005`):** password reset, staff
self-registration, generic assignment authoring, Roblox feedback delivery, live monitoring, gamification,
leaderboards, advanced reports, notifications, any new presentation locale, WEB-M4.

## Key upstream decisions this milestone relies on

- `02_35 v1.0` (`quest-city-roblox`) — canonical staff identity/authorization/dashboard-review contract: role
  model, session security parameters, class-scope enforcement rule, the two-axis `teacher_feedback` status
  model, the recovery-assignment additive-column design, the 8 staff error codes, idempotency/concurrency
  requirements.
- `02_26 v1.8 §31` — the staff-scoped endpoint surface documented alongside the existing student-facing one.
- `contracts/quest-city-platform-openapi-v1_6.yaml` (source commit `b8d28266`) — the exact 18-path additive
  surface this milestone implements one-to-one; no endpoint beyond it was added.
- `AGENTS.md` §4.21 rule 16 (staff-identity exception) — the precondition this milestone's own
  authorization/audit model satisfies for the recovery-assignment write path.
- `docs/adr/0003` (WEB-M2B) — the `ErrorEnvelope` shape and generation-based idempotency pattern this
  milestone extends (via the `scope` parameterization) rather than reimplements.

## Known residual items

1. **CSRF token loss on page reload is by design, not a bug** — see ADR-0005's "CSRF token held in memory
   only" section. The dashboard degrades to `authenticated-read-only` (reads work, mutations require signing
   in again) rather than appearing fully logged out.
2. **No "list feedback by attempt" read exists in OpenAPI v1.6.** `apps/dashboard/app/app/attempts/
   [attemptId]/review/page.tsx` therefore only shows a `teacher_feedback` it created earlier in the *same*
   page visit (kept in local React state) — a feedback created in an earlier visit, or by another staff
   member, is not re-displayed there. This is a canonical-contract gap, not an implementation oversight; a
   future milestone adding that read is additive.
3. **Local `next dev` cross-origin fetches need `NEXT_PUBLIC_API_BASE_URL_DASHBOARD` set explicitly** —
   `apps/dashboard`'s fetch client defaults to a same-origin relative path, which is correct behind the
   production/Docker-compose Nginx topology (07_06 §3) but requires the env var in a local dev setup where
   `apps/api` and `apps/dashboard` run on separate ports. This mirrors an existing, pre-WEB-M3B limitation
   already shared by `apps/student-web`'s own `NEXT_PUBLIC_API_BASE_URL` — no CORS layer exists anywhere in
   this codebase, by design, since the canonical topology is same-origin everywhere it matters.
4. **`check-i18n-strings.mjs` needed no code change.** Its `SCAN_DIRS` already recursively walks the entire
   `apps/dashboard` tree, so the new `app/app/**` pages are covered without any tooling edit — verified by
   inspection of the walker, not assumed.
5. **`tools/check-i18n-strings.mjs` remains a heuristic scanner** (see `docs/implementation/
   web-i18n-foundation.md`, item 6) — this milestone's new pages were written with that heuristic's known
   blind spots in mind (no multi-line JSX text split across lines without an intervening tag) but did not
   change the tool itself.
6. **AGENTS.md §4.22 rule 10 audit finding, closed during final regression.** Rule 10 requires every
   sensitive action — including *read* access to the review queue and to attempt review detail, not only
   writes — to be recorded in `audit_event`. The initial implementation only audited the mutating actions
   (login, review transitions, feedback publish/revoke, recovery-assignment creation). Found during the
   AGENTS.md audit pass, fixed before this report: `ReviewService.list()` now records
   `staff_review_queue_accessed`, and `GET /attempts/{attemptId}/review` now records
   `staff_attempt_review_accessed`, both via the existing `audit_event` table (no parallel audit table). No
   other §4.22 rule (1-12) required a code change beyond what was already implemented; this was the only gap
   found. Full regression re-run clean after the fix (80/80 integration tests, excluding the unrelated,
   pre-existing `health-endpoints.test.ts` environment dependency on a running Nginx reverse proxy).
7. **`tools/seed-staff.ts` has no `--rotate-password` mode.** An operator who needs to change an existing
   staff member's password must currently do so directly against the database (or a future, separately
   authorized reset flow) — the seed script's "never overwrite an existing account" guarantee is deliberate
   and is not relaxed here.
