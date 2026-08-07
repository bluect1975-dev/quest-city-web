---
adr_id: "ADR-0002"
title: "WEB-M1 Fase 2: canonical identity model, PIN hashing and session security parameters"
status: "Approved"
date: "2026-08-06"
related_change_set: "WEB-M1 Fase 2"
---

# ADR-0002 – WEB-M1 Fase 2: canonical identity model, PIN hashing and session security parameters

## Context

WEB-M1 Fase 1 (`quest-city-roblox`, commit `2b9f722e3ca64bc95e5260e0820fb6a77b924893`) registered the identity/session
data model (`02_25 §6.1/§6.10/§6.11`), API contract (`02_26 §30`,
`contracts/quest-city-platform-openapi-v1_3.yaml`) and binding security
baseline (`AGENTS.md` "WEB-M1 implementation baseline") for student
class-code + alias + PIN login. Fase 2 implements that baseline in this
repository. Several implementation-level parameters are deliberately left
to configuration by the governing documents and required a concrete
decision here, corrected once by the product owner before authorization
(WEB-M1 Fase 2 correction report, 2026-08-06):

- Whether `tenant` and `audit_event` are Web-local tables or the first
  physical implementation of the canonical shared backend model.
- The exact PIN hash storage format, its parser's defensive behaviour, and
  the exact scrypt cost parameters.
- Which hash function protects opaque session/CSRF/class-code tokens.
- The exact TTL, rate-limit threshold, and token-length values.
- How the `Secure` cookie attribute is tested locally without weakening
  staging/production.

## Decision

**Canonical backend, not a Web-local schema.** `tenant` and `audit_event`
are created in migration `0002_canonical_identity_and_web_enrollment.sql`
with the exact column set from `02_25 §6.1`/`§6.10` — no reduction. This
repository is the *first physical implementation* of the shared backend
model (`02_24 §22-23`: "Nessun secondo curriculum o database"; `05_01
§17`: "duplicazione di database" is forbidden without a dedicated ADR). A
second `tenant`/`audit_event`/identity table for Roblox or any other
consumer requires a new ADR — it is not permitted as a routine change.

**PIN hashing.** Node's built-in `crypto.scrypt` (no new external
dependency). Stored as a self-describing, versioned string (not the formal
PHC format — WEB-M1 Fase 2 correction report D6):

```text
scrypt$v=1$N=16384$r=8$p=5$keylen=64$<salt-base64url>$<hash-base64url>
```

Binding parameters (authorized in this change set, not to be altered
without a new ADR): `N=16384`, `r=8`, `p=5`, `keylen=64` bytes, `salt=16`
bytes CSPRNG, `maxmem=32 MiB`. The parser (`packages/identity/src/crypto/pin.ts`)
validates algorithm and version, rejects any field that is missing,
duplicated, reordered or unrecognized, applies independent upper/lower
bounds to every parameter *before* invoking scrypt (defense against a
corrupted or tampered stored hash forcing an oversized computation), and
compares the derived digest with `timingSafeEqual`. `needsRehash()`
flags a hash whose version/parameters no longer match the current target,
so a future parameter change can transparently upgrade hashes on next
successful login rather than requiring a data migration.

**Session/CSRF token hashing.** Session and CSRF tokens are 256-bit CSPRNG
values (`node:crypto.randomBytes`), hashed with plain `sha256` and compared
with `timingSafeEqual` — not scrypt. Unlike a 6-8 digit PIN, these tokens
carry enough entropy that a computational cost factor adds request latency
on every authenticated call without a corresponding security benefit
(WEB-M1 Fase 2 correction report D3).

**Class-code hashing — HMAC-SHA-256, not plain SHA-256 (WEB-M1 Fase 2
second correction, binding).** A class code is a *shared, legible*
classroom secret (8 characters from a 33-symbol alphabet, ≈40 bits of
entropy) — far weaker than a 256-bit session/CSRF token. Hashing it with
plain, unkeyed SHA-256 would let anyone who obtained the
`class_access_code` table (e.g. via a backup leak or a SQL-injection read
elsewhere) precompute the entire code space offline and recover every
class code without ever touching the running application. `crypto/class-code.ts`
therefore hashes it with **HMAC-SHA-256 keyed by `CLASS_CODE_HASH_PEPPER`**,
a server-side-only key never derived from or reused between any other
secret in the system:

- `decodeClassCodePepper(raw)` requires the env value to be non-empty,
  valid base64, and decode to **≥ 32 bytes**; it throws otherwise, and its
  error message never includes the raw value (only lengths and the
  variable name), so it is always safe to log.
- **No default value, in any environment.** `apps/api/lib/env.ts#loadEnv`
  and `tools/seed-pilot.ts` both call `decodeClassCodePepper` unconditionally
  — a missing or too-short pepper fails startup in development the same as
  in staging and production. `apps/api/instrumentation.ts` calls `loadEnv()`
  once via Next.js's `register()` hook so this is a true process-boot
  failure, not something that only surfaces on the first request that
  happens to touch identity code.
- `hashClassCode(normalizedCode, pepper)` is deterministic — the same
  normalized code and the same pepper always produce the same digest,
  which is what the `class_access_code.code_hash` equality lookup relies
  on; a different pepper or a different code always produces a different
  digest (verified in `crypto/class-code.test.ts`).
- `compareClassCodeHash` provides a `timingSafeEqual`-based comparison for
  any future in-process digest comparison; the primary lookup path
  (`class_access_code_hash_active_uq`, an indexed SQL equality) is a
  database operation, not an application-level secret comparison, so it is
  not itself a timing side-channel in the way a hand-rolled byte-by-byte
  comparison in request-handling code would be.
- Session and CSRF token hashing (above) is unaffected — they remain plain
  SHA-256, since a keyed hash adds no defense for an already
  256-bit-entropy, non-guessable value.

**Rate limiting (D7, binding).** `FIXED_WINDOW`, 15-minute windows:
`CLASS_CODE_RESOLVE_IP=30`, `CLASS_CODE_RESOLVE_CODE=60`,
`SESSION_START_IP=30`, `SESSION_START_ENROLLMENT=5`. The enrollment
dimension is keyed by `classId:normalizedAlias` rather than the
enrollment's row id, so an attempt against a *nonexistent* alias is still
rate-limited (it cannot be bypassed simply by targeting aliases that don't
exist).

**Session TTLs.** Absolute `43200` s (12h), inactivity `3600` s (60min),
both configurable via `.env` (`SESSION_ABSOLUTE_TTL_SECONDS`,
`SESSION_INACTIVITY_TTL_SECONDS`). A session found past either deadline is
lazily revoked with the matching `revoked_reason`
(`ABSOLUTE_EXPIRY`/`INACTIVITY_TIMEOUT`) the next time it is looked up,
rather than left in an ambiguous un-revoked state.

**`Secure` cookie, local vs. production.** `Secure` is unconditional
everywhere except when `NODE_ENV === "development"` *and*
`SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL=true` is explicitly set —
this is an allow-list on `development`, not a deny-list of just
`production`, so staging inherits the same non-negotiable posture as
production. The check is enforced in `apps/api/lib/env.ts`, not merely
documented.

**Token accessibility — precise criteria (WEB-M1 Fase 2 second correction #2).**
The two token types have *different*, not identical, JavaScript-accessibility
rules — a single "no token is ever exposed to JS" statement is imprecise and
must not be used:

- The **session token** is never accessible to client-side JavaScript, in
  any form — it lives exclusively in the `HttpOnly` `qc_web_session` cookie
  and is never present in any JSON response body (`apps/api/lib/session-cookie.ts`
  builds it only as a `Set-Cookie` header value).
- The **CSRF token** *is* accessible to client-side JavaScript, by design —
  the client must read it from the `session/start`/`session/refresh`
  response body in order to echo it back via `X-CSRF-Token` on the next
  mutating request. The constraint is not "never readable" but "held only
  in memory client-side, never written to `localStorage`, `sessionStorage`
  or any cookie."

**Seed script.** `tools/seed-pilot.ts`, run via `tsx` (the one new
dev-only dependency introduced by this change set — needed because the
identity package's TypeScript source uses extensionless relative imports
that Node's native type-stripping cannot resolve on its own, while
`tsx`'s bundler-style resolution matches the rest of the toolchain).
Requires `--out`, refuses a path inside the Git root, refuses to
overwrite an existing file, sets `0600` permissions where the filesystem
supports it, and prints only counts and the output path — never a class
code, alias or PIN.

## Consequences

- Any future table introduced for Roblox-side identity (`roblox_account_link`,
  etc.) extends this same schema in a later migration; it must never
  duplicate `tenant` or `audit_event`.
- Changing any of the scrypt parameters, rate-limit thresholds, or TTLs
  above is a decision requiring the same authorization as this ADR, not a
  routine code change — `needsRehash()` exists specifically so that a
  future, authorized parameter change does not require a PIN data
  migration.
- `tsx` is now a dependency of `@quest-city-web/tools` only; no other
  package needs it, and no production runtime depends on it.
- `CLASS_CODE_HASH_PEPPER` is a new mandatory secret in every environment
  (development, staging, production) and in the seed script's own shell
  environment — deployment tooling and local `.env` files must provision
  it before `apps/api` or `tools/seed-pilot.ts` can start/run at all.
  `ClassCodeService` and `SessionService` constructors both now take the
  decoded pepper as a required (non-optional, no-default) argument.
- Out of scope: WEB-M2 (content bundle loader, attempt lifecycle, semantic
  action, outcome, validator fixture), Roblox linking, magic link,
  federated login, administrative UI, reward, mastery.

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial decision: canonical shared backend model, PIN hash format and scrypt parameters, token hashing, rate-limit thresholds, session TTLs, Secure cookie policy, seed script security requirements. |
| 1.1 | 2026-08-06 | Second correction: class-code hashing changed from plain SHA-256 to HMAC-SHA-256 keyed by the new mandatory `CLASS_CODE_HASH_PEPPER` (no default, in any environment; validated at process startup via `apps/api/instrumentation.ts`); documented the precise, non-symmetric session-vs-CSRF token JavaScript-accessibility criteria. |
