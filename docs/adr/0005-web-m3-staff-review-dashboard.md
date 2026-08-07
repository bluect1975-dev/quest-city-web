---
adr_id: "ADR-0005"
title: "WEB-M3B: staff identity, dashboard review queue, teacher feedback and recovery assignment implementation"
status: "Approved"
date: "2026-08-07"
related_change_set: "WEB-M3B"
---

# ADR-0005 – WEB-M3B: staff identity, dashboard review queue, teacher feedback and recovery assignment implementation

## Context

WEB-M3A (`quest-city-roblox`, commit `b8d28266ce2646c1cebc76e2dfa5d949854e573a`) registered the canonical
contract for the staff/teacher identity, authorization and dashboard-review subset: `02_35 v1.0`
("Staff Identity, Authorization and Dashboard Review Contract"), `02_26 v1.8 §31`, and
`contracts/quest-city-platform-openapi-v1_6.yaml` (18 additive paths). Several implementation-level decisions
were deliberately left open by that contract and required a concrete choice here:

- How a second identity domain (staff) coexists with WEB-M1's student identity in the same monorepo without
  duplicating or silently coupling to student credential mechanisms.
- How `review_queue_item`/`teacher_feedback` writes reuse the existing generation-based idempotency mechanism
  (WEB-M2B, ADR-0003) across five new scopes instead of introducing a second, competing one.
- How `teacher_feedback`'s two-axis status model (`publicationStatus`/`deliveryStatus`) is enforced at the
  database level without losing information across a publish → read → revoke sequence.
- How a recovery assignment is created without becoming generic assignment authoring (AGENTS.md §4.21 rule 16).
- How the dashboard UI holds the staff session's CSRF token given the canonical contract's explicit
  "held client-side in memory only" requirement (02_35 §4.4), and what that implies for a page reload.
- What is explicitly deferred: password reset, staff self-registration, generic assignment authoring, Roblox
  feedback delivery, live monitoring, gamification, leaderboards, advanced reports, notifications, and any new
  presentation locale.

## Decision

### Package coupling boundary: `packages/staff-identity`

Depends on `@quest-city-web/identity` (reuses, never duplicates, `TenantRepository`/`SchoolClassRepository`/
`StudentProfileRepository`/`SchoolEnrollmentRepository` — required by "non duplicare school_class/
student_profile/school_enrollment") and on `@quest-city-web/attempts` (reuses `LearningAttemptRepository`/
`AssignmentRepository` — the single attempt ledger, never copied). It does **not** reuse `class_access_code`,
PIN hashing, or `student_session` — those remain exclusively `@quest-city-web/identity`'s own mechanism
(02_35 §2.1's explicit enumerated list). Password hashing is self-contained
(`packages/staff-identity/src/crypto/password.ts`, independent scrypt parameters — `N=32768` vs. the student
PIN's `N=16384`, reflecting a higher-privilege credential — and independent vocabulary, not imported from
`packages/identity`'s PIN module) even though the two algorithms share the same self-describing hash-format
shape. Token generation/hashing (`generateToken`/`hashToken`/`verifyTokenHash`) and `checkFixedWindow` **are**
reused directly from `@quest-city-web/identity` — both are generic infrastructure with no identity-specific
semantics, unlike the credential mechanisms above.

### `staff_session` vs. `student_session`

Entirely separate table, cookie name (`qc_staff_session` vs. `qc_web_session`), and env-configured TTLs
(`STAFF_SESSION_*` vs. `SESSION_*`) — never the same row or cookie (02_35 §2.1, §4.4). `apps/api/lib/
staff-session-cookie.ts` and `staff-csrf-guard.ts` mirror `session-cookie.ts`/`csrf-guard.ts` structurally but
are separate modules, each reading its own env fields, rather than parameterizing the shared ones — the two
apps that consume them (`apps/student-web`, `apps/dashboard`) already have independent trusted-origin lists
(`WEB_AUTH_TRUSTED_ORIGINS` vs. `STAFF_AUTH_TRUSTED_ORIGINS`) since they run on different origins.

### Idempotency mechanism generalized, not duplicated

`packages/attempts/src/repository/idempotency-record-repository.ts`'s `begin()`/`complete()`/`fail()` had the
scope hardcoded to the SQL literal `'attempt_completion'`. Migration `0004` extends
`idempotency_record_scope_check` to allow five new staff-write scopes
(`staff_feedback_create`, `staff_feedback_publish`, `staff_feedback_revoke`, `staff_review_transition`,
`staff_recovery_assignment_create`) — reusing them required parameterizing `scope` as an explicit argument
instead of the literal, so `IdempotencyRecordRepository` now takes `scope: string` on every call
(`packages/attempts/src/services/idempotency-service.ts` was updated to pass `"attempt_completion"` explicitly,
preserving its exact existing behaviour). The underlying atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE`
mechanism and generation-based optimistic concurrency (ADR-0003) are otherwise unmodified and shared unchanged
across every scope — one mechanism per operation, never two competing ones, now genuinely enforced across both
milestones' write paths rather than just WEB-M2B's.

### `teacher_feedback` two orthogonal status axes

`publicationStatus` (`DRAFT`/`PUBLISHED`/`REVOKED`, docente-controlled) and `deliveryStatus`
(`NOT_APPLICABLE`/`PENDING`/`DELIVERED`/`READ`/`FAILED`, system/runtime-controlled) are enforced by a single
`CASE`-based `CHECK` constraint (migration `0004`), following the exact same NULL-safe discipline as
`learning_attempt.attempt_state`/`completion_status` (ADR-0003): only `IS [NOT] NULL` and a NOT-NULL-guarded
`IN`, never a bare `= literal` on a nullable column. `REVOKED` explicitly permits `delivery_status` to remain
at whatever value it held before revocation (`PENDING`/`DELIVERED`/`READ`/`FAILED`) — a flat single-enum
model cannot represent "published, then read, then later revoked" without either losing the read signal or
inventing a sixth combined state; the two-axis model needed no such invention. `TeacherFeedbackRepository.
publish()`/`revoke()` are optimistic-concurrency writes (`WHERE version = $expectedVersion`), matching the
`If-Match`/`ETAG_MISMATCH` contract from `02_26 §8.2`.

### Recovery assignment: additive columns, not a new table

`assignment` gains exactly two nullable/defaulted columns — `origin_type` (`ADMIN_SEED` default, or
`RECOVERY_FROM_REVIEW`) and `target_student_profile_id` — bound by
`CHECK ((origin_type = 'RECOVERY_FROM_REVIEW') = (target_student_profile_id IS NOT NULL))`. Every pre-existing
row defaults to `ADMIN_SEED`/`NULL`, so WEB-M2B's class-wide assignment behaviour is unchanged. **Not** in
conflict with AGENTS.md §4.21 rule 16 ("le assegnazioni non hanno un endpoint pubblico di creazione"): the
rule's own stated precondition for an exception is a staff identity/authorization/audit model, which this
milestone is. `RecoveryAssignmentService.create()` is the sole write path, gated on the referenced
`teacher_feedback.publicationStatus === 'PUBLISHED'` (`RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED` otherwise) —
there is still no generic `POST /assignments`.

### Review queue: one parametric transition endpoint

`POST /review/{reviewItemId}/status` accepts a `targetStatus` body field rather than five separate
claim/release/resolve/dismiss/reopen endpoints, per the OpenAPI v1.6 authoring instruction to minimize API
surface. `ReviewService.transitionStatus()` validates the transition against a fixed `ALLOWED_TRANSITIONS` map
(`OPEN → IN_REVIEW|RESOLVED|DISMISSED`, `IN_REVIEW → OPEN|RESOLVED|DISMISSED`, `RESOLVED|DISMISSED → OPEN`)
before writing, returning `VALIDATION_ERROR` (409) for anything else. Reviewer attribution
(`reviewer_staff_account_id`/`reviewed_at`) is set on every transition except into `OPEN`, matching the DB
`CHECK ((reviewed_at IS NULL) = (reviewer_staff_account_id IS NULL))`.

### CSRF token held in memory only — dashboard UI consequence

02_35 §4.4 requires the CSRF token to live client-side in memory only, never a cookie, `localStorage`, or
`sessionStorage`. A hard page reload therefore always loses it, and no endpoint exists to recover one for an
existing session — only `POST /staff-auth/session/start` issues a fresh token (`/staff-auth/session/refresh`
itself *requires* the token it would be recovering). `apps/dashboard/lib/staff-auth-context.tsx` models this
as a fourth auth status, `authenticated-read-only`: `GET /me/staff-context` still succeeds off the session
cookie alone after a reload, so read views keep working, but `RequireStaffAuth` does not block them — every
mutating action in the UI independently requires a non-null in-memory token, degrading gracefully to "sign in
again" rather than the whole app appearing logged out. This is a direct, accepted consequence of the canonical
contract's own security trade-off, not a workaround for a bug.

### Explicitly out of scope (deferred, not silently ignored)

- **Password reset.** No endpoint, no UI. An operator must re-provision via `tools/seed-staff.ts` (which
  refuses to overwrite an existing account) until a reset flow is separately authorized.
- **Staff self-registration.** No public endpoint creates a `staff_account` — `tools/seed-staff.ts` is the
  sole controlled, offline provisioning path, mirroring `tools/seed-pilot.ts`'s WEB-M1 precedent.
- **Generic assignment authoring.** Only the single recovery-assignment path exists; `assignment` still has no
  general-purpose create/update endpoint.
- **Roblox feedback delivery.** `teacher_feedback.deliveryStatus` exists in the data model (`NOT_APPLICABLE`
  through `FAILED`) but nothing in this package or `apps/api` ever transitions it past its `PENDING` default —
  no delivery mechanism to the Roblox runtime is implemented. `freeText` is never included in any payload this
  milestone produces.
- **Live monitoring, gamification, leaderboards, advanced reports, notifications.** None of the 18 endpoints
  or `/app/**` pages implement any of these — the dashboard IA is limited to what 02_35 §5-§11 defines.
  `GET /attempts/{attemptId}/feedback` (a "list feedback for this attempt" read) does not exist in OpenAPI
  v1.6 either — the dashboard's attempt-review page therefore only shows a feedback object it created earlier
  in the same page visit (held in local React state), not one from a prior visit; documented in
  `docs/implementation/web-m3-staff-review-dashboard.md`.
- **A second presentation locale.** All new UI strings are it-IT only, added to the existing
  `packages/i18n` catalogs (`dashboard.json`'s new `app.*` namespace, `errors.json`'s ten new staff codes) —
  no new locale directory.
- **WEB-M4 and anything beyond 02_35's scope.**

## Consequences

- Any future password-reset or self-registration milestone must reuse `packages/staff-identity`'s
  `StaffAccountRepository`/scrypt format rather than inventing a parallel credential path.
- A future Roblox feedback-delivery milestone should reuse the existing `deliveryStatus` enum and
  `teacher_feedback` row unchanged — no new delivery-status table or column should be needed, only a writer
  that transitions `PENDING → DELIVERED/READ/FAILED`.
- If a "list feedback by attempt" read becomes necessary, it is a new, additive OpenAPI path (a ninth staff
  read), not a retrofit onto `GET /attempts/{attemptId}/review`, which composes existing entities only and was
  authorized not to invent new derived data.
- `IdempotencyRecordRepository`'s `scope` parameterization is now the interface every future idempotent write
  path (staff or otherwise) should use — the CHECK-constraint extension pattern in migration `0004` is the
  template for adding another scope later.
