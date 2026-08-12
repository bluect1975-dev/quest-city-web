-- 0008_school_onboarding_staff_membership: implements the School Pilot
-- Readiness Tranche B canonical contract (quest-city-roblox main
-- 0f4be149ec095c2143240a3d51a32af943720e59: 02_35 v1.2 §11bis, 02_26 v1.11
-- §8.1/§33, 02_25 v1.7 §6.12, AGENTS.md v4.51 §4.22bis,
-- contracts/quest-city-platform-openapi-v1_9.yaml).
--
-- Four independent, additive changes, each reusing an existing mechanism
-- unmodified rather than introducing a new one (AGENTS.md rule 19, one
-- mechanism per concern):
--   A. staff_tenant_membership.status widens from two values to four
--      (INVITED, REVOKED added) -- same column, same CHECK-constraint
--      pattern already used by every other status column in this corpus.
--   B. staff_invitation is a new, narrowly-scoped entity (02_35 §11bis.3
--      decision B -- NOT a reuse of any generation-1 invitation table,
--      none exists in this schema) -- same structural shape as
--      staff_class_assignment/staff_session: composite FK to
--      staff_tenant_membership(id, tenant_id), one-time token_hash.
--   C. assignment.origin_type widens from two values to three
--      (STAFF_GENERAL added, 02_35 §11bis.9) -- the existing
--      assignment_recovery_target_consistency CHECK
--      ((origin_type = 'RECOVERY_FROM_REVIEW') = (target_student_profile_id
--      IS NOT NULL)) already generalizes correctly to a third value with
--      NO edit: STAFF_GENERAL falls on the same "IS NULL" side as
--      ADMIN_SEED, exactly as the contract requires, so only the origin_type
--      CHECK itself needs widening.
--   D. idempotency_record.scope gains the 10 new scope values named by
--      02_35 §11bis.11 / 02_26 §8.1 (one per mutating write introduced by
--      this milestone, invitation acceptance deliberately excluded --
--      it is already one-time by construction via
--      staff_invitation.consumed_at) -- same table, same
--      generation-based PENDING/COMPLETED/FAILED mechanism, same
--      IdempotencyRecordRepository, unmodified.
--   E. staff_account gains one additive column, requires_password_setup
--      (default false), plus a new created_by_actor_type value, 'SCHOOL_ADMIN'
--      -- both needed to implement the contract's own stated rule (02_35
--      v1.2 §11bis.3): acceptStaffInvitation's `password` field is
--      "Required only when the underlying staff_account has no usable
--      credential yet." createdByActorType alone cannot answer that
--      question reliably over time (it never changes after creation, but
--      "has a real password" does, the moment accept() sets one) --
--      requires_password_setup is the actual state flag: true only for a
--      brand-new identity created directly by this invitation flow with a
--      placeholder credential, flipped to false the moment
--      acceptStaffInvitation sets a real, human-chosen password. Every
--      pre-existing row defaults to false (ADMIN_SEED_SCRIPT/
--      ADMIN_BOOTSTRAP_SCRIPT/PLATFORM_ADMIN-created accounts already
--      have a real, disclosed-once credential -- see
--      SchoolAdminActivationService's temporaryPassword), so this
--      migration changes no existing account's behaviour.
--
-- No existing row is affected by A, C or E's CHECK/DEFAULT widenings:
-- every staff_tenant_membership row today is ACTIVE or SUSPENDED (both
-- remain valid), every assignment row today is ADMIN_SEED or
-- RECOVERY_FROM_REVIEW (both remain valid), every staff_account row today
-- gets requires_password_setup = false (its real, correct value) --
-- widening a CHECK's allowed set or adding a defaulted column can never
-- invalidate or change a row that already satisfied the narrower set. B
-- is a new table (nothing to migrate). D only adds new allowed scope
-- strings (nothing to migrate).

-- A. staff_tenant_membership.status: INVITED, REVOKED added (02_35 v1.2
-- §11bis.2). SUSPENDED's existing reversible-without-reinvite semantics is
-- unchanged; REVOKED is new and terminal-until-reinvited, distinct from
-- SUSPENDED.
ALTER TABLE staff_tenant_membership DROP CONSTRAINT staff_tenant_membership_status_check;
ALTER TABLE staff_tenant_membership ADD CONSTRAINT staff_tenant_membership_status_check
  CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED'));

-- B. staff_invitation (02_35 §11bis.3): FK directly to
-- staff_tenant_membership, same structural pattern as
-- staff_class_assignment/staff_session (migration 0004). One-time,
-- hashed-only token (token_hash UNIQUE); the plaintext token is returned
-- exactly once by the create-invitation response and never persisted.
-- issued_by_staff_account_id records the SCHOOL_ADMIN who issued it
-- (audit/traceability); consumed_at/revoked_at are the two independent
-- terminal markers a token can reach, both nullable, never both set for
-- an invitation that was consumed and later "revoked" -- REVOKE on an
-- already-ACTIVE membership operates on staff_tenant_membership.status,
-- not on a consumed staff_invitation row (02_35 §11bis.2's REVOKED
-- transition is legal from INVITED/ACTIVE/SUSPENDED and reuses the same
-- staff_invitation row only for the re-invite path, via a fresh row).
CREATE TABLE staff_invitation (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_tenant_membership_id  UUID NOT NULL,
  tenant_id                   UUID NOT NULL REFERENCES tenant (id),
  token_hash                  TEXT NOT NULL UNIQUE,
  issued_by_staff_account_id  UUID NOT NULL REFERENCES staff_account (id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ NOT NULL,
  consumed_at                 TIMESTAMPTZ,
  revoked_at                  TIMESTAMPTZ,
  FOREIGN KEY (staff_tenant_membership_id, tenant_id) REFERENCES staff_tenant_membership (id, tenant_id),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX staff_invitation_membership_idx ON staff_invitation (staff_tenant_membership_id);
CREATE INDEX staff_invitation_tenant_idx ON staff_invitation (tenant_id);

-- C. assignment.origin_type: STAFF_GENERAL added (02_35 v1.2 §11bis.9).
-- No new column -- target_student_profile_id stays NULL for
-- STAFF_GENERAL exactly like ADMIN_SEED, already enforced by the existing
-- assignment_recovery_target_consistency CHECK (migration 0004),
-- untouched here since its formula already generalizes correctly to a
-- third origin_type value.
ALTER TABLE assignment DROP CONSTRAINT assignment_origin_type_check;
ALTER TABLE assignment ADD CONSTRAINT assignment_origin_type_check
  CHECK (origin_type IN ('ADMIN_SEED', 'RECOVERY_FROM_REVIEW', 'STAFF_GENERAL'));

-- D. idempotency_record.scope: 10 new scopes, one per mutating write
-- introduced by this milestone (02_35 §11bis.11, 02_26 §8.1) --
-- POST /staff/invitations/accept is deliberately excluded (already
-- one-time by construction via staff_invitation.consumed_at, 02_35
-- §11bis.11). Same DROP/ADD CONSTRAINT pattern already used by migrations
-- 0004/0006/0007; same table, same mechanism, no second one.
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_scope_check
  CHECK (scope IN ('attempt_completion', 'staff_feedback_create', 'staff_feedback_publish',
                    'staff_feedback_revoke', 'staff_review_transition', 'staff_recovery_assignment_create',
                    'platform_school_admin_activate', 'platform_tenant_create',
                    'staff_invitation_create', 'staff_membership_status_update',
                    'staff_class_create', 'staff_class_update', 'staff_class_archive',
                    'staff_class_teacher_assign', 'staff_class_teacher_unassign',
                    'staff_roster_add', 'staff_roster_remove', 'staff_general_assignment_create'));

-- E. staff_account: requires_password_setup + new created_by_actor_type
-- value (see rationale above). Same DROP/ADD CONSTRAINT pattern already
-- used by migration 0006 for this exact constraint.
ALTER TABLE staff_account ADD COLUMN requires_password_setup BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE staff_account DROP CONSTRAINT staff_account_created_by_actor_type_check;
ALTER TABLE staff_account ADD CONSTRAINT staff_account_created_by_actor_type_check
  CHECK (created_by_actor_type IN ('ADMIN_SEED_SCRIPT', 'ADMIN_BOOTSTRAP_SCRIPT', 'PLATFORM_ADMIN', 'SCHOOL_ADMIN'));
