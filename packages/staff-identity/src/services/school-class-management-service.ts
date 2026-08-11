import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, SchoolClassRepository, type SchoolClassStatus } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { StaffTenantMembershipRepository } from "../repository/staff-tenant-membership-repository";
import { StaffClassAssignmentRepository } from "../repository/staff-class-assignment-repository";
import { assertStaffCapability } from "./capability";
import { assertClassInScope } from "./authorization";
import type { StaffInternalIdentity } from "./staff-auth-service";

const SCOPE_CREATE = "staff_class_create";
const SCOPE_UPDATE = "staff_class_update";
const SCOPE_ARCHIVE = "staff_class_archive";
const SCOPE_ASSIGN = "staff_class_teacher_assign";
const SCOPE_UNASSIGN = "staff_class_teacher_unassign";

export interface SchoolClassResult {
  classId: string;
  name: string;
  status: SchoolClassStatus;
  createdAt: string;
}

export interface TeacherClassAssignmentResult {
  staffTenantMembershipId: string;
  classId: string;
  createdAt: string;
}

function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

function toResult(c: { id: string; name: string; status: SchoolClassStatus; createdAt: Date }): SchoolClassResult {
  return { classId: c.id, name: c.name, status: c.status, createdAt: c.createdAt.toISOString() };
}

/**
 * `POST /classes`, `PATCH /classes/{classId}`, `POST
 * /classes/{classId}/archive`, `POST/DELETE /classes/{classId}/teachers`
 * (02_35 v1.2 §11bis.5-§11bis.6). `school_class` is the sole canonical
 * class model (`classroom`/`class_teacher` are legacy/superseded, never
 * used here). Tenant is always resolved server-side from the staff
 * session — no client-supplied tenant id anywhere in this service.
 */
export class SchoolClassManagementService {
  private readonly classes: SchoolClassRepository;
  private readonly memberships: StaffTenantMembershipRepository;
  private readonly classAssignments: StaffClassAssignmentRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.classes = new SchoolClassRepository(pool);
    this.memberships = new StaffTenantMembershipRepository(pool);
    this.classAssignments = new StaffClassAssignmentRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: { identity: StaffInternalIdentity; name: string; idempotencyKey: string }): Promise<SchoolClassResult> {
    const { identity, name } = input;
    assertStaffCapability(identity, "class.create");

    return this.withIdempotency(identity, SCOPE_CREATE, input.idempotencyKey, { name }, async () => {
      const publicId = `cls_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const created = await this.classes.create({ tenantId: identity.tenantId, publicId, name, status: "ACTIVE" });
      const result = toResult(created);
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "class_created",
        targetType: "school_class",
        targetId: created.id,
        result: "SUCCESS",
      });
      return result;
    });
  }

  async update(input: {
    identity: StaffInternalIdentity;
    classId: string;
    name: string;
    idempotencyKey: string;
  }): Promise<SchoolClassResult> {
    const { identity, classId, name } = input;
    assertStaffCapability(identity, "class.manage");
    assertClassInScope(identity, classId);

    return this.withIdempotency(identity, SCOPE_UPDATE, input.idempotencyKey, { classId, name }, async () => {
      const updated = await this.classes.updateName(classId, identity.tenantId, name);
      if (!updated) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      const result = toResult(updated);
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "class_updated",
        targetType: "school_class",
        targetId: updated.id,
        result: "SUCCESS",
      });
      return result;
    });
  }

  async archive(input: { identity: StaffInternalIdentity; classId: string; idempotencyKey: string }): Promise<SchoolClassResult> {
    const { identity, classId } = input;
    assertStaffCapability(identity, "class.manage");
    assertClassInScope(identity, classId);

    return this.withIdempotency(identity, SCOPE_ARCHIVE, input.idempotencyKey, { classId }, async () => {
      const current = await this.classes.findById(classId, identity.tenantId);
      if (!current) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      if (current.status === "ARCHIVED") {
        throw new StaffIdentityError("CLASS_ALREADY_ARCHIVED");
      }
      const archived = await this.classes.archive(classId, identity.tenantId);
      if (!archived) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      const result = toResult(archived);
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "class_archived",
        targetType: "school_class",
        targetId: archived.id,
        result: "SUCCESS",
      });
      return result;
    });
  }

  async assignTeacher(input: {
    identity: StaffInternalIdentity;
    classId: string;
    staffTenantMembershipId: string;
    idempotencyKey: string;
  }): Promise<TeacherClassAssignmentResult> {
    const { identity, classId, staffTenantMembershipId } = input;
    assertStaffCapability(identity, "class.teacher.assign");
    assertClassInScope(identity, classId);

    return this.withIdempotency(identity, SCOPE_ASSIGN, input.idempotencyKey, { classId, staffTenantMembershipId }, async () => {
      const schoolClass = await this.classes.findById(classId, identity.tenantId);
      if (!schoolClass) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      const targetMembership = await this.memberships.findById(staffTenantMembershipId, identity.tenantId);
      if (!targetMembership) {
        throw new StaffIdentityError("MEMBERSHIP_NOT_FOUND");
      }
      if (targetMembership.role !== "TEACHER" || targetMembership.status !== "ACTIVE") {
        throw new StaffIdentityError("TEACHER_MEMBERSHIP_NOT_ACTIVE");
      }
      const existing = await this.classAssignments.findByMembershipAndClass(staffTenantMembershipId, classId, identity.tenantId);
      if (existing) {
        throw new StaffIdentityError("TEACHER_ALREADY_ASSIGNED");
      }
      const created = await this.classAssignments.create({ staffTenantMembershipId, classId, tenantId: identity.tenantId });
      const result: TeacherClassAssignmentResult = {
        staffTenantMembershipId: created.staffTenantMembershipId,
        classId: created.classId,
        createdAt: created.createdAt.toISOString(),
      };
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "class_teacher_assigned",
        targetType: "staff_class_assignment",
        targetId: created.id,
        result: "SUCCESS",
      });
      return result;
    });
  }

  async unassignTeacher(input: {
    identity: StaffInternalIdentity;
    classId: string;
    staffTenantMembershipId: string;
    idempotencyKey: string;
  }): Promise<TeacherClassAssignmentResult> {
    const { identity, classId, staffTenantMembershipId } = input;
    assertStaffCapability(identity, "class.teacher.assign");
    assertClassInScope(identity, classId);

    return this.withIdempotency(identity, SCOPE_UNASSIGN, input.idempotencyKey, { classId, staffTenantMembershipId }, async () => {
      const schoolClass = await this.classes.findById(classId, identity.tenantId);
      if (!schoolClass) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      const deleted = await this.classAssignments.delete(staffTenantMembershipId, classId, identity.tenantId);
      if (!deleted) {
        // Not anti-enumeration here: staffTenantMembershipId is not a secret (02_35 §11bis.6).
        throw new StaffIdentityError("MEMBERSHIP_NOT_FOUND");
      }
      const result: TeacherClassAssignmentResult = {
        staffTenantMembershipId,
        classId,
        createdAt: new Date().toISOString(),
      };
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "class_teacher_unassigned",
        targetType: "staff_class_assignment",
        targetId: staffTenantMembershipId,
        result: "SUCCESS",
      });
      return result;
    });
  }

  /** Shared begin/complete/fail idempotency wrapper — same generation-based mechanism for every mutation in this service, no second one. */
  private async withIdempotency<T>(
    identity: StaffInternalIdentity,
    scope: string,
    idempotencyKey: string,
    payload: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope,
      scopeKey: idempotencyKey,
      requestHash: requestHashOf(payload),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as T;
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
      const result = await run();
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope,
        scopeKey: idempotencyKey,
        expectedGeneration: begin.generation,
        response: result,
      });
      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope,
        scopeKey: idempotencyKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
