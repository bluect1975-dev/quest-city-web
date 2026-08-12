import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { StaffTenantMembershipRepository, type StaffRole, type StaffTenantMembershipStatus } from "../repository/staff-tenant-membership-repository";
import { StaffClassAssignmentRepository } from "../repository/staff-class-assignment-repository";
import { assertStaffCapability } from "./capability";
import type { StaffInternalIdentity } from "./staff-auth-service";

const IDEMPOTENCY_SCOPE = "staff_membership_status_update";

export type MembershipStatusAction = "SUSPEND" | "REACTIVATE" | "REVOKE";

export interface StaffMemberSummary {
  staffTenantMembershipId: string;
  staffAccountId: string;
  email: string;
  role: StaffRole;
  status: StaffTenantMembershipStatus;
  classScope: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffMembershipStatusResult {
  staffTenantMembershipId: string;
  status: StaffTenantMembershipStatus;
  updatedAt: string;
}

const NEW_STATUS_BY_ACTION: Record<MembershipStatusAction, StaffTenantMembershipStatus> = {
  SUSPEND: "SUSPENDED",
  REACTIVATE: "ACTIVE",
  REVOKE: "REVOKED",
};

/** Legal source statuses for each action (02_35 v1.2 §11bis.2, transition table). */
const LEGAL_SOURCE_STATUSES: Record<MembershipStatusAction, StaffTenantMembershipStatus[]> = {
  SUSPEND: ["ACTIVE"],
  REACTIVATE: ["SUSPENDED"],
  REVOKE: ["INVITED", "ACTIVE", "SUSPENDED"],
};

function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/**
 * `GET /staff/members` + `PATCH /staff/members/{staffTenantMembershipId}`
 * (02_35 v1.2 §11bis.2/§11bis.4). SUSPEND/REACTIVATE governed by
 * `staff.membership.suspend` (one capability, two directions, same
 * pattern as `tenant.suspend`); REVOKE by `staff.membership.revoke`.
 */
export class StaffMembershipService {
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly classAssignments: StaffClassAssignmentRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.classAssignments = new StaffClassAssignmentRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async list(
    identity: StaffInternalIdentity,
    input: { limit: number; offset: number; emailByAccountId: (staffAccountId: string) => Promise<string> },
  ): Promise<StaffMemberSummary[]> {
    assertStaffCapability(identity, "staff.member.read");
    const rows = await this.memberships.findByTenant(identity.tenantId, input);
    const summaries: StaffMemberSummary[] = [];
    for (const row of rows) {
      const classScope =
        row.role === "TEACHER"
          ? (await this.classAssignments.findByMembership(row.id, identity.tenantId)).map((a) => a.classId)
          : null;
      summaries.push({
        staffTenantMembershipId: row.id,
        staffAccountId: row.staffAccountId,
        email: await input.emailByAccountId(row.staffAccountId),
        role: row.role,
        status: row.status,
        classScope,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    return summaries;
  }

  async updateStatus(input: {
    identity: StaffInternalIdentity;
    staffTenantMembershipId: string;
    action: MembershipStatusAction;
    idempotencyKey: string;
  }): Promise<StaffMembershipStatusResult> {
    const { identity, staffTenantMembershipId, action } = input;
    const capability = action === "REVOKE" ? "staff.membership.revoke" : "staff.membership.suspend";
    assertStaffCapability(identity, capability);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: requestHashOf({ staffTenantMembershipId, action }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as StaffMembershipStatusResult;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const target = await this.memberships.findById(staffTenantMembershipId, identity.tenantId);
      if (!target) {
        throw new StaffIdentityError("MEMBERSHIP_NOT_FOUND");
      }
      if (!LEGAL_SOURCE_STATUSES[action].includes(target.status)) {
        throw new StaffIdentityError("MEMBERSHIP_STATUS_UNCHANGED");
      }

      // LAST_SCHOOL_ADMIN_PROTECTED (02_35 §11bis.2): a SCHOOL_ADMIN can
      // never suspend or revoke their OWN membership if it is the last
      // ACTIVE SCHOOL_ADMIN membership in the tenant.
      if (
        (action === "SUSPEND" || action === "REVOKE") &&
        target.staffAccountId === identity.staffAccountId &&
        target.role === "SCHOOL_ADMIN"
      ) {
        const activeCount = await this.memberships.countActiveSchoolAdmins(identity.tenantId);
        if (activeCount <= 1) {
          throw new StaffIdentityError("LAST_SCHOOL_ADMIN_PROTECTED");
        }
      }

      const newStatus = NEW_STATUS_BY_ACTION[action];
      const updated = await this.memberships.updateStatus(staffTenantMembershipId, identity.tenantId, newStatus);
      if (!updated) throw new Error("staff_tenant_membership: updateStatus produced no row");

      const result: StaffMembershipStatusResult = {
        staffTenantMembershipId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt.toISOString(),
      };

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });

      const actionEvent = { SUSPEND: "staff_membership_suspended", REACTIVATE: "staff_membership_reactivated", REVOKE: "staff_membership_revoked" }[
        action
      ];
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: actionEvent,
        targetType: "staff_tenant_membership",
        targetId: updated.id,
        result: "SUCCESS",
      });

      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
