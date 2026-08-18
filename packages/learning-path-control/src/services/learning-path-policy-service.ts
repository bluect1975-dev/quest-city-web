import type { Pool } from "pg";
import { StaffIdentityError, assertClassInScope, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { StudentProfileRepository, SchoolEnrollmentRepository, AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { SupportStudentAssignmentRepository, resolveStudentSupportScope, assertStudentSupportScope } from "@quest-city-web/student-support";
import { LearningPathPolicyRepository, type LearningPathPolicy } from "../repository/learning-path-policy-repository";
import { LearningPathAlternativeRepository } from "../repository/learning-path-alternative-repository";
import {
  resolveEffectiveAvailability,
  type LearningPathReasonCategory,
  type LearningPathResourceType,
  type LearningPathScope,
  type LearningPathState,
  type EffectiveResolution,
  type PedagogicalRole,
  type LearningPathPolicyInput,
} from "../resolver/resolve-effective-availability";

export interface CreateLearningPathPolicyInput {
  identity: StaffInternalIdentity;
  scope: LearningPathScope;
  scopeClassId?: string | null | undefined;
  scopeStudentPublicId?: string | null | undefined;
  resourceType: LearningPathResourceType;
  resourceRef: string;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  reasonNotes?: string | null;
  alternativeContentRef?: string | null;
  deploymentYear?: string | null;
  idempotencyKey: string;
}

const CREATE_IDEMPOTENCY_SCOPE = "learning_path_policy_upsert";
const DELETE_IDEMPOTENCY_SCOPE = "learning_path_policy_delete";

/**
 * `POST/GET/DELETE /learning-path-policies`, `GET /learning-path/effective`
 * (02_41 v1.1, contracts/quest-city-platform-openapi-v1_15.yaml). Capability
 * resolution happens here, not in the resolver (02_41 §13: the resolver
 * stays a pure cascade function; authority is a service-layer concern).
 *
 * PLATFORM scope is deliberately NOT handled by this service -- it is
 * gated by @quest-city-web/platform-admin's own capability_grant mechanism
 * (same separation already established for convergence.execute), and its
 * write path is out of scope for this Web implementation's required
 * browser scenarios (mission §60, A-G — none involve a Platform Admin UI).
 * The resolver itself (resolveEffectiveAvailability) still fully honors an
 * existing PLATFORM-scope UNAVAILABLE_FOR_USE row wherever one exists.
 */
export class LearningPathPolicyService {
  private readonly policies: LearningPathPolicyRepository;
  private readonly alternatives: LearningPathAlternativeRepository;
  private readonly students: StudentProfileRepository;
  private readonly supportAssignments: SupportStudentAssignmentRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.policies = new LearningPathPolicyRepository(pool);
    this.alternatives = new LearningPathAlternativeRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.supportAssignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: CreateLearningPathPolicyInput): Promise<LearningPathPolicy> {
    const { identity } = input;
    let scopeClassId: string | null = null;
    let scopeStudentProfileId: string | null = null;

    if (input.scope === "SCHOOL") {
      assertStaffCapability(identity, "learning_path.school.manage");
    } else if (input.scope === "CLASS") {
      if (!input.scopeClassId) throw new StaffIdentityError("VALIDATION_ERROR", "scopeClassId required for scope=CLASS.");
      assertStaffCapability(identity, "learning_path.class.manage");
      assertClassInScope(identity, input.scopeClassId);
      scopeClassId = input.scopeClassId;
    } else if (input.scope === "STUDENT") {
      if (!input.scopeStudentPublicId) throw new StaffIdentityError("VALIDATION_ERROR", "scopeStudentPublicId required for scope=STUDENT.");
      assertStaffCapability(identity, "learning_path.student.manage");
      const student = await this.requireStudentInManageScope(identity, input.scopeStudentPublicId);
      scopeStudentProfileId = student.id;
    } else {
      // PLATFORM: rejected here -- see class doc comment. A caller that
      // reaches this branch has no learning_path.school/class/student.manage
      // capability path for it, so this is always a forbidden request from
      // the perspective of this service.
      throw new StaffIdentityError("LEARNING_PATH_POLICY_FORBIDDEN", "PLATFORM-scope policies are managed by Platform Content Admin, not this service.");
    }

    if (input.state === "DISABLED_AND_WAIVED" || input.state === "DISABLED_WITH_ALTERNATIVE") {
      assertStaffCapability(identity, "learning_path.waiver.manage");
    }
    if (input.state === "DISABLED_WITH_ALTERNATIVE") {
      if (!input.alternativeContentRef) {
        throw new StaffIdentityError("VALIDATION_ERROR", "alternativeContentRef required for state=DISABLED_WITH_ALTERNATIVE.");
      }
      const alternative = await this.alternatives.findByAlternativeContentRef(identity.tenantId, input.alternativeContentRef);
      if (!alternative) {
        throw new StaffIdentityError("LEARNING_PATH_ALTERNATIVE_INVALID", "No published, authorized learning_path_alternative found for this ref.");
      }
    }

    // Hard-lock enforcement at write time (02_41 §10): resolve what the
    // scope(s) ABOVE this one currently allow, before persisting. A write
    // that would contradict a currently-effective higher-scope explicit
    // DISABLED/UNAVAILABLE_FOR_USE is rejected outright -- it is never
    // silently stored as an inactive/shadowed row via this endpoint;
    // shadowing only applies to a *previously valid* lower policy later
    // overtaken by a *new* higher restriction (02_41 §11), never to a
    // write that is invalid from the moment it is made.
    if (input.state === "ENABLED") {
      let hardLockClassId: string | null = null;
      if (input.scope === "STUDENT" && scopeStudentProfileId) {
        const enrollment = await this.enrollments.findCurrentByStudent(scopeStudentProfileId, identity.tenantId);
        hardLockClassId = enrollment?.classId ?? null;
      }
      const parentPolicies = await this.policies.findForResource(identity.tenantId, input.resourceType, input.resourceRef, {
        classId: input.scope === "STUDENT" ? hardLockClassId : scopeClassId,
      });
      const parentResolution = resolveEffectiveAvailability({
        resourceType: input.resourceType,
        resourceRef: input.resourceRef,
        policiesByScope: toPoliciesByScope(parentPolicies.filter((p) => p.scope !== input.scope)),
      });
      if (parentResolution.effectiveAvailability === "EFFECTIVE_UNAVAILABLE") {
        throw new StaffIdentityError("LEARNING_PATH_PARENT_DISABLED", `A higher scope (${parentResolution.sourceScope}) already restricts this resource.`);
      }
    }

    const scopeKey = input.idempotencyKey;
    const requestHash = JSON.stringify({
      scope: input.scope,
      scopeClassId,
      scopeStudentProfileId,
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      state: input.state,
      reasonCategory: input.reasonCategory,
      reasonNotes: input.reasonNotes ?? null,
      alternativeContentRef: input.alternativeContentRef ?? null,
      deploymentYear: input.deploymentYear ?? null,
    });
    const begin = await this.idempotency.begin({ tenantId: identity.tenantId, scope: CREATE_IDEMPOTENCY_SCOPE, scopeKey, requestHash });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as LearningPathPolicy;
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
      const created = await this.policies.upsert({
        tenantId: identity.tenantId,
        scope: input.scope,
        scopeClassId,
        scopeStudentProfileId,
        resourceType: input.resourceType,
        resourceRef: input.resourceRef,
        state: input.state,
        reasonCategory: input.reasonCategory,
        reasonNotes: input.reasonNotes ?? null,
        alternativeContentRef: input.state === "DISABLED_WITH_ALTERNATIVE" ? (input.alternativeContentRef ?? null) : null,
        deploymentYear: input.deploymentYear ?? null,
        createdByStaffAccountId: identity.staffAccountId,
      });

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: CREATE_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });

      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: this.resolveAuditAction(input.scope, input.state),
        targetType: "learning_path_policy",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { scope: input.scope, resourceType: input.resourceType, state: input.state, reasonCategory: input.reasonCategory },
      });

      return created;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: CREATE_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async delete(identity: StaffInternalIdentity, publicId: string, idempotencyKey: string): Promise<void> {
    const existing = await this.policies.findByPublicId(publicId, identity.tenantId);
    if (!existing) throw new StaffIdentityError("VALIDATION_ERROR", "learning_path_policy not found.");

    if (existing.scope === "SCHOOL") {
      assertStaffCapability(identity, "learning_path.school.manage");
    } else if (existing.scope === "CLASS") {
      assertStaffCapability(identity, "learning_path.class.manage");
      if (existing.scopeClassId) assertClassInScope(identity, existing.scopeClassId);
    } else if (existing.scope === "STUDENT") {
      assertStaffCapability(identity, "learning_path.student.manage");
      if (existing.scopeStudentProfileId) {
        await this.assertStudentInManageScope(identity, existing.scopeStudentProfileId);
      }
    } else {
      throw new StaffIdentityError("LEARNING_PATH_POLICY_FORBIDDEN");
    }

    const scopeKey = idempotencyKey;
    const requestHash = JSON.stringify({ publicId });
    const begin = await this.idempotency.begin({ tenantId: identity.tenantId, scope: DELETE_IDEMPOTENCY_SCOPE, scopeKey, requestHash });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return;
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
      const deleted = await this.policies.delete(publicId, identity.tenantId);
      if (!deleted) throw new StaffIdentityError("VALIDATION_ERROR", "learning_path_policy not found.");

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: DELETE_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: { deleted: true },
      });

      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action:
          existing.scope === "SCHOOL"
            ? "learning_path.school_changed"
            : existing.scope === "CLASS"
              ? "learning_path.class_changed"
              : "learning_path.student_changed",
        targetType: "learning_path_policy",
        targetId: existing.id,
        result: "SUCCESS",
        metadataRedacted: { scope: existing.scope, action: "reverted_to_inherit" },
      });
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: DELETE_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /**
   * `GET /learning-path-policies` -- capability `learning_path.preview`
   * (read-only) or the corresponding `.manage` capability for the queried
   * scope (OpenAPI v1.15.0 listLearningPathPolicies). Always scoped to the
   * caller's tenant. `shadowed` (02_41 §11-12) is computed per row at read
   * time, never persisted -- for each row, the full policy context up to
   * and including that row's own scope is re-resolved and the row is
   * marked shadowed iff the resolver recorded it in
   * `shadowedLowerScopePolicyIds` (a blocked ENABLED attempt under a
   * currently-effective higher restriction).
   */
  async list(
    identity: StaffInternalIdentity,
    filter: {
      scope?: LearningPathScope | undefined;
      scopeRef?: string | undefined;
      resourceType?: LearningPathResourceType | undefined;
      resourceRef?: string | undefined;
    },
    pagination: { limit: number; offset: number },
  ): Promise<Array<LearningPathPolicy & { shadowed: boolean }>> {
    assertStaffCapability(identity, "learning_path.preview");

    let scopeRefId: string | undefined;
    if (filter.scope === "CLASS" && filter.scopeRef) {
      assertClassInScope(identity, filter.scopeRef);
      scopeRefId = filter.scopeRef;
    } else if (filter.scope === "STUDENT" && filter.scopeRef) {
      const student = await this.requireStudentInManageScope(identity, filter.scopeRef);
      scopeRefId = student.id;
    }

    const rows = await this.policies.listByScope(
      identity.tenantId,
      { scope: filter.scope, scopeRef: scopeRefId, resourceType: filter.resourceType, resourceRef: filter.resourceRef },
      pagination,
    );

    return Promise.all(rows.map(async (row) => ({ ...row, shadowed: await this.computeShadowed(identity.tenantId, row) })));
  }

  private async computeShadowed(tenantId: string, row: LearningPathPolicy): Promise<boolean> {
    let classId: string | null = row.scopeClassId;
    if (row.scope === "STUDENT" && row.scopeStudentProfileId) {
      const enrollment = await this.enrollments.findCurrentByStudent(row.scopeStudentProfileId, tenantId);
      classId = enrollment?.classId ?? null;
    }
    const context = await this.policies.findForResource(tenantId, row.resourceType, row.resourceRef, {
      classId,
      studentProfileId: row.scopeStudentProfileId,
    });
    const resolution = resolveEffectiveAvailability({
      resourceType: row.resourceType,
      resourceRef: row.resourceRef,
      policiesByScope: toPoliciesByScope(context),
    });
    return resolution.shadowedLowerScopePolicyIds.includes(row.id);
  }

  /** `GET /learning-path/effective` -- single-resource resolution, server-authoritative (02_41 §22, §39, §51). Called before every content launch, not only by preview UI. */
  async resolveEffective(
    identity: StaffInternalIdentity,
    input: {
      resourceType: LearningPathResourceType;
      resourceRef: string;
      classId?: string | null | undefined;
      studentPublicId?: string | null | undefined;
      pedagogicalRole?: PedagogicalRole | undefined;
    },
  ): Promise<EffectiveResolution> {
    let studentProfileId: string | undefined;
    let classId: string | null = input.classId ?? null;
    if (input.studentPublicId) {
      const student = await this.students.findByPublicId(input.studentPublicId);
      if (!student || student.tenantId !== identity.tenantId) {
        throw new StaffIdentityError("LEARNING_PATH_RESOURCE_NOT_AVAILABLE", "Student not found.");
      }
      studentProfileId = student.id;
      if (!classId) {
        // Never rely on the caller to supply classId for a student
        // resolution (02_41 §30-32/§45: a direct-launch check must not miss
        // the student's own CLASS-scope hard lock just because the API
        // layer omitted it).
        const enrollment = await this.enrollments.findCurrentByStudent(student.id, identity.tenantId);
        classId = enrollment?.classId ?? null;
      }
    }
    const policies = await this.policies.findForResource(identity.tenantId, input.resourceType, input.resourceRef, {
      classId,
      studentProfileId,
    });
    return resolveEffectiveAvailability({
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      pedagogicalRole: input.pedagogicalRole,
      policiesByScope: toPoliciesByScope(policies),
    });
  }

  /**
   * `GET /classes/{classId}/learning-path/preview` (02_41 §32-34, mission
   * §33-34 mandatory, OpenAPI v1.15.0 getClassLearningPathPreview -- no
   * request body, no resource list parameter). The node set previewed is
   * every distinct (resourceType, resourceRef) that currently has at
   * least one explicit `learning_path_policy` row reachable from this
   * class (PLATFORM/SCHOOL, this CLASS, or its roster's STUDENT rows) --
   * there is no curriculum_profile/class_curriculum_module table in this
   * schema to enumerate a full curriculum tree from (migration 0013
   * header). A pure-INHERIT node with no explicit policy anywhere has
   * nothing to preview beyond the default and is correctly omitted.
   */
  async previewClass(identity: StaffInternalIdentity, classId: string): Promise<EffectiveResolution[]> {
    assertStaffCapability(identity, "learning_path.preview");
    assertClassInScope(identity, classId);
    // Batched (02_41 §14-15, mission §14-15: never one query per unit
    // element) -- a single query covers every resource for the whole class
    // roster; STUDENT-scope rows are then excluded below, since a Class
    // Preview shows what generically applies at PLATFORM/SCHOOL/CLASS,
    // never one specific student's override (that is Student Preview's job).
    const roster = await this.enrollments.findByClass(classId, identity.tenantId);
    const allPolicies = await this.policies.findForClassAndStudents(
      identity.tenantId,
      classId,
      roster.map((e) => e.studentProfileId),
    );
    return distinctResourceKeys(allPolicies).map(({ resourceType, resourceRef }) => {
      const relevant = allPolicies.filter((p) => p.resourceType === resourceType && p.resourceRef === resourceRef && p.scope !== "STUDENT");
      return resolveEffectiveAvailability({ resourceType, resourceRef, policiesByScope: toPoliciesByScope(relevant) });
    });
  }

  /**
   * `GET /students/{studentPublicId}/learning-path/preview` (02_41 §32-34,
   * mission §33-34 "Che cosa vedrà questo studente?" -- mandatory,
   * OpenAPI v1.15.0 getStudentLearningPathPreview, no resource list
   * parameter). Node set: every distinct resource with an explicit policy
   * reachable from this student (PLATFORM/SCHOOL, their current CLASS, or
   * their own STUDENT rows) -- same discovered-schema rationale as
   * `previewClass`.
   */
  async previewStudent(identity: StaffInternalIdentity, studentPublicId: string): Promise<EffectiveResolution[]> {
    assertStaffCapability(identity, "learning_path.preview");
    const student = await this.requireStudentInManageScope(identity, studentPublicId);
    const enrollment = await this.enrollments.findCurrentByStudent(student.id, identity.tenantId);
    const allPolicies = await this.policies.findForClassAndStudents(identity.tenantId, enrollment?.classId ?? null, [student.id]);
    return distinctResourceKeys(allPolicies).map(({ resourceType, resourceRef }) => {
      const relevant = allPolicies.filter((p) => p.resourceType === resourceType && p.resourceRef === resourceRef);
      return resolveEffectiveAvailability({ resourceType, resourceRef, policiesByScope: toPoliciesByScope(relevant) });
    });
  }

  private async requireStudentInManageScope(identity: StaffInternalIdentity, studentPublicId: string) {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("LEARNING_PATH_RESOURCE_NOT_AVAILABLE", "Student not found.");
    }
    await this.assertStudentInManageScope(identity, student.id);
    return student;
  }

  /**
   * SUPPORT_TEACHER: own ACTIVE support_student_assignment, or own
   * assigned class's roster (02_41 §21, 02_39 §3bis.2 contitolarità) --
   * never school-wide. TEACHER: own class roster only. SCHOOL_ADMIN/
   * INDEPENDENT_EDUCATOR: tenant-wide. Reuses `resolveStudentSupportScope`
   * verbatim from @quest-city-web/student-support -- the exact same
   * scope resolution already ratified for the Student Support Roles
   * surface, never a second/parallel scope-check implementation.
   */
  private async assertStudentInManageScope(identity: StaffInternalIdentity, studentProfileId: string): Promise<void> {
    if (identity.role === "SCHOOL_ADMIN" || identity.role === "INDEPENDENT_EDUCATOR") return;
    if (identity.role === "TEACHER" || identity.role === "SUPPORT_TEACHER") {
      const scope = await resolveStudentSupportScope(identity, studentProfileId, {
        supportAssignments: this.supportAssignments,
        enrollments: this.enrollments,
      });
      assertStudentSupportScope(scope);
      return;
    }
    throw new StaffIdentityError("LEARNING_PATH_POLICY_FORBIDDEN");
  }

  /** Audit action naming (mission §40, 02_41 §54): a WAIVED write is always reported as `learning_path.waived` regardless of scope, since "a student was excused" is the operationally meaningful event; every other state uses the per-scope `_changed` action. */
  private resolveAuditAction(scope: LearningPathScope, state: LearningPathState): string {
    if (state === "DISABLED_AND_WAIVED") return "learning_path.waived";
    if (scope === "SCHOOL") return "learning_path.school_changed";
    if (scope === "CLASS") return "learning_path.class_changed";
    return "learning_path.student_changed";
  }
}

function distinctResourceKeys(policies: LearningPathPolicy[]): { resourceType: LearningPathResourceType; resourceRef: string }[] {
  const seen = new Map<string, { resourceType: LearningPathResourceType; resourceRef: string }>();
  for (const p of policies) {
    seen.set(`${p.resourceType}:${p.resourceRef}`, { resourceType: p.resourceType, resourceRef: p.resourceRef });
  }
  return [...seen.values()];
}

export function toPoliciesByScope(policies: LearningPathPolicy[]): Partial<Record<LearningPathScope, LearningPathPolicyInput>> {
  const result: Partial<Record<LearningPathScope, LearningPathPolicyInput>> = {};
  for (const p of policies) {
    result[p.scope] = { id: p.id, scope: p.scope, state: p.state, reasonCategory: p.reasonCategory, alternativeContentRef: p.alternativeContentRef };
  }
  return result;
}
