-- 0010_independent_educator_foundation: implements the School Pilot
-- Readiness Tranche C canonical contract (quest-city-roblox main
-- f2d99ade28199805743c677c63bc9e51a72458a7: 02_25 v1.9 §6.13-6.14, 02_35
-- v1.4 §11ter, 02_26 v1.13 §35, 02_38 v1.3 §4.4/§7/§9/§13/§18/§21,
-- contracts/quest-city-platform-openapi-v1_11.yaml).
--
-- Five independent, additive changes, each reusing an existing mechanism
-- unmodified rather than introducing a new one (AGENTS.md rule 19):
--   A. tenant.type: ORGANIZATION retired, INDEPENDENT_EDUCATOR added (02_25
--      v1.9 §6.13.1). Guarded by an explicit pre-flight check that fails
--      loudly if any real ORGANIZATION row exists (none can, per the
--      canonical research this migration implements: no creation path in
--      this codebase -- POST /platform/tenants, tools/seed-pilot.ts -- has
--      ever produced anything but SCHOOL).
--   B. staff_tenant_membership.role: INDEPENDENT_EDUCATOR added as a third
--      value (02_35 v1.4 §11ter.2 decision A), plus a new cross-table
--      coherence trigger (02_25 v1.9 §6.14, 02_35 v1.4 §11ter.3): a
--      role=INDEPENDENT_EDUCATOR membership is valid only on a
--      tenant.type=INDEPENDENT_EDUCATOR tenant, and symmetrically a
--      role IN (TEACHER, SCHOOL_ADMIN) membership is valid only on a
--      tenant.type=SCHOOL tenant. Same trigger-based cross-table
--      enforcement pattern already used by migration 0004's
--      reject_staff_class_assignment_for_non_teacher.
--   C. capability_grant.capability: three new PLATFORM_ADMIN-only
--      capabilities (independent_educator.activate, .read,
--      .status.manage), same CHECK-widening pattern as migration 0006's
--      own five-value list.
--   D. idempotency_record: two new scopes --
--      platform_independent_educator_activate (tenant_id NULL, same
--      architecture as platform_tenant_create/migration 0007, since no
--      tenant exists yet at request time) and
--      platform_independent_educator_status_update (tenant-scoped, same
--      shape as staff_membership_status_update/migration 0008 --
--      PATCH .../status always targets an existing tenant).
--   E. No IndependentEducatorProfile table (02_25 v1.9 §6.13.2 decision,
--      confirmed unchanged): tenant + staff_account +
--      staff_tenant_membership already suffice, same precedent as the
--      never-implemented `school` table.
--
-- No existing row is affected by B or C's CHECK widenings (widening an
-- allowed set can never invalidate a row already inside the narrower set).
-- A requires and enforces the absence of ORGANIZATION rows explicitly,
-- rather than assuming it.

-- A. tenant.type: pre-flight guard, then retire ORGANIZATION and add
-- INDEPENDENT_EDUCATOR in the same statement (02_25 v1.9 §6.13.1). This
-- is a hard stop, not a warning: if it fires, the correct classification
-- per the governing instruction is BLOCKED_DATA_MIGRATION_CONFLICT, and
-- this migration must not proceed past it.
DO $$
DECLARE
  organization_row_count INTEGER;
BEGIN
  SELECT count(*) INTO organization_row_count FROM tenant WHERE type = 'ORGANIZATION';
  IF organization_row_count > 0 THEN
    RAISE EXCEPTION 'BLOCKED_DATA_MIGRATION_CONFLICT: % tenant row(s) with type=ORGANIZATION exist; 0010 cannot retire this value (02_25 v1.9 §6.13.1)', organization_row_count;
  END IF;
END $$;

ALTER TABLE tenant DROP CONSTRAINT tenant_type_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_type_check
  CHECK (type IN ('SCHOOL', 'INDEPENDENT_EDUCATOR'));

-- B. staff_tenant_membership.role: INDEPENDENT_EDUCATOR added (02_35 v1.4
-- §11ter.2 decision A).
ALTER TABLE staff_tenant_membership DROP CONSTRAINT staff_tenant_membership_role_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_role_check
  CHECK (role IN ('TEACHER', 'SCHOOL_ADMIN', 'INDEPENDENT_EDUCATOR'));

-- Tenant/role coherence (02_25 v1.9 §6.14, 02_35 v1.4 §11ter.3): enforced
-- server-side via trigger, never a cross-table CHECK (Postgres cannot
-- express one directly) -- same discipline as migration 0004's
-- reject_staff_class_assignment_for_non_teacher.
CREATE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence() RETURNS trigger AS $$
DECLARE
  resolved_tenant_type TEXT;
BEGIN
  SELECT type INTO resolved_tenant_type FROM tenant WHERE id = NEW.tenant_id;
  IF NEW.role = 'INDEPENDENT_EDUCATOR' AND resolved_tenant_type IS DISTINCT FROM 'INDEPENDENT_EDUCATOR' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role INDEPENDENT_EDUCATOR requires tenant.type=INDEPENDENT_EDUCATOR, tenant % has type % (02_25 v1.9 §6.14)',
      NEW.tenant_id, resolved_tenant_type;
  END IF;
  IF NEW.role IN ('TEACHER', 'SCHOOL_ADMIN') AND resolved_tenant_type IS DISTINCT FROM 'SCHOOL' THEN
    RAISE EXCEPTION 'staff_tenant_membership: role % requires tenant.type=SCHOOL, tenant % has type % (02_25 v1.9 §6.14)',
      NEW.role, NEW.tenant_id, resolved_tenant_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_tenant_membership_role_tenant_type_coherence
  BEFORE INSERT OR UPDATE OF role, tenant_id ON staff_tenant_membership
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_tenant_membership_role_tenant_type_coherence();

-- C. capability_grant.capability: three new PLATFORM_ADMIN-only
-- capabilities (02_26 v1.13 §35.8). Same DROP/ADD CONSTRAINT pattern
-- already used by migration 0006 for this exact constraint.
ALTER TABLE capability_grant DROP CONSTRAINT capability_grant_capability_check;
ALTER TABLE capability_grant ADD CONSTRAINT capability_grant_capability_check
  CHECK (capability IN
    ('tenant.create', 'tenant.read', 'tenant.suspend',
     'school_admin.activate', 'audit.read.global',
     'independent_educator.activate', 'independent_educator.read', 'independent_educator.status.manage'));

-- D. idempotency_record: two new scopes (02_26 v1.13 §35.9).
-- platform_independent_educator_activate joins platform_tenant_create in
-- the tenant_id-NULL set (no tenant exists yet at request time, same
-- architecture as migration 0007);
-- platform_independent_educator_status_update is a normal tenant-scoped
-- write, same shape as staff_membership_status_update (migration 0008).
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_platform_scope_tenant_id_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_platform_scope_tenant_id_check
  CHECK ((scope IN ('platform_tenant_create', 'platform_independent_educator_activate')) = (tenant_id IS NULL));

ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create',
                    'staff_class_access_code_issue',
                    'platform_independent_educator_activate', 'platform_independent_educator_status_update'));

-- The existing partial unique index idempotency_record_platform_scope_key_idx
-- (migration 0007) is already generic over `scope` -- WHERE tenant_id IS
-- NULL -- so platform_independent_educator_activate is covered without
-- any change to it.
