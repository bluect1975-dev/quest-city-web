-- 0007_platform_tenant_create_idempotency: closes the tenant-creation
-- idempotency gap disclosed (not hidden) by migration 0006's own comment
-- and formally resolved by a dedicated canonical contract audit
-- (BLOCKED_CANONICAL_CONTRACT -> PLATFORM_ADMIN_API_CONTRACTS_CLOSED,
-- quest-city-roblox 02_26 v1.10 §32.4, OpenAPI v1.8). `POST
-- /platform/tenants` is the one write in this corpus that necessarily
-- precedes the existence of its own tenant, so `idempotency_record`
-- (migration 0003, extended by 0004/0006) -- whose `tenant_id` has been
-- NOT NULL by design for every scope until now -- could not previously
-- cover it. Reuses the same table, the same generation-based
-- PENDING/COMPLETED/FAILED mechanism and the same
-- IdempotencyRecordRepository unmodified (AGENTS.md v4.30/v4.50, one
-- idempotency mechanism per operation, never two competing ones) --
-- this migration only widens `tenant_id` to nullable for the one new
-- scope that structurally requires it, and adds the extra index that
-- nullability requires for correct deduplication.

-- `tenant_id` becomes nullable at the column level, but a CHECK
-- constraint immediately re-closes the gap for every existing (and any
-- future) tenant-scoped scope: `tenant_id` must be NULL if and only if
-- `scope = 'platform_tenant_create'`. No existing row is affected --
-- every row inserted before this migration has a real `tenant_id` and a
-- scope other than `platform_tenant_create` (which did not exist as a
-- valid value before this migration's own scope-check extension below),
-- so the new CHECK is satisfied by 100% of pre-existing data without a
-- backfill.
ALTER TABLE idempotency_record ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope = 'platform_tenant_create') = (tenant_id IS NULL));

-- idempotency_record.scope: extend for platform_tenant_create (same
-- DROP/ADD CONSTRAINT pattern already used by migrations 0004/0006).
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create'));

-- The existing composite UNIQUE (tenant_id, scope, scope_key) cannot
-- deduplicate tenant_id IS NULL rows -- SQL NULLs are never equal to
-- each other, so Postgres would happily accept unlimited rows with the
-- same (scope, scope_key) as long as tenant_id stays NULL. This partial
-- unique index does, for the platform_tenant_create scope only, exactly
-- what the composite constraint already does for every tenant-scoped
-- scope -- and nothing else; it cannot be satisfied by, and does not
-- affect, any row with a non-NULL tenant_id (the composite constraint
-- keeps covering those unchanged).
CREATE UNIQUE INDEX idempotency_record_platform_scope_key_idx
  ON idempotency_record (scope, scope_key)
  WHERE tenant_id IS NULL;
