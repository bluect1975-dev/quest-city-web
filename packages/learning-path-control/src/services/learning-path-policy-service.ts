import type { Pool } from "pg";
import { StaffIdentityError, assertClassInScope, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { StudentProfileRepository, SchoolEnrollmentRepository, AuditRepository } from "@quest-city-web/identity";
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
  scopeClassId?: string | null;
  scopeStudentPublicId?: string | null;
  resourceType: LearningPathResourceType;
  resourceRef: string;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  reasonNotes?: string | null;
  alternativeContentRef?: string | null;
  deploymentYear?: string | null;
}

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
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.policies = new LearningPathPolicyRepository(pool);
    this.alternatives = new LearningPathAlternativeRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.supportAssignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
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
  }

  async delete(identity: StaffInternalIdentity, publicId: string): Promise<void> {
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

    const deleted = await this.policies.delete(publicId, identity.tenantId);
    if (!deleted) throw new StaffIdentityError("VALIDATION_ERROR", "learning_path_policy not found.");

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
  }

  /** `GET /learning-path/effective` -- single-resource resolution, server-authoritative (02_41 §22, §39, §51). Called before every content launch, not only by preview UI. */
  async resolveEffective(
    identity: StaffInternalIdentity,
    input: { resourceType: LearningPathResourceType; resourceRef: string; classId?: string | null; studentPublicId?: string | null; pedagogicalRole?: PedagogicalRole },
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
   * `GET /classes/{classId}/learning-path/preview`, `GET
   * /students/{studentPublicId}/learning-path/preview` (02_41 §32-34,
   * mission §33-34 mandatory). `resources` is supplied by the API layer --
   * the actual set of resource refs meaningfully assigned to the class/
   * student (e.g. from `assignment`/`content_bundle`), never an invented
   * full curriculum enumeration (no curriculum_profile/class_curriculum_module
   * table exists in this schema -- see migration 0013 header).
   */
  async previewClass(
    identity: StaffInternalIdentity,
    classId: string,
    resources: { resourceType: LearningPathResourceType; resourceRef: string; pedagogicalRole?: PedagogicalRole }[],
  ): Promise<EffectiveResolution[]> {
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
    return resources.map((r) => {
      const relevant = allPolicies.filter(
        (p) => p.resourceType === r.resourceType && p.resourceRef === r.resourceRef && p.scope !== "STUDENT",
      );
      return resolveEffectiveAvailability({
        resourceType: r.resourceType,
        resourceRef: r.resourceRef,
        pedagogicalRole: r.pedagogicalRole,
        policiesByScope: toPoliciesByScope(relevant),
      });
    });
  }

  async previewStudent(
    identity: StaffInternalIdentity,
    studentPublicId: string,
    resources: { resourceType: LearningPathResourceType; resourceRef: string; pedagogicalRole?: PedagogicalRole }[],
  ): Promise<EffectiveResolution[]> {
    assertStaffCapability(identity, "learning_path.preview");
    const student = await this.requireStudentInManageScope(identity, studentPublicId);
    const enrollment = await this.enrollments.findCurrentByStudent(student.id, identity.tenantId);
    const policies = await Promise.all(
      resources.map((r) =>
        this.policies.findForResource(identity.tenantId, r.resourceType, r.resourceRef, {
          classId: enrollment?.classId ?? null,
          studentProfileId: student.id,
        }),
      ),
    );
    return resources.map((r, i) =>
      resolveEffectiveAvailability({
        resourceType: r.resourceType,
        resourceRef: r.resourceRef,
        pedagogicalRole: r.pedagogicalRole,
        policiesByScope: toPoliciesByScope(policies[i] ?? []),
      }),
    );
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

function toPoliciesByScope(policies: LearningPathPolicy[]): Partial<Record<LearningPathScope, LearningPathPolicyInput>> {
  const result: Partial<Record<LearningPathScope, LearningPathPolicyInput>> = {};
  for (const p of policies) {
    result[p.scope] = { id: p.id, scope: p.scope, state: p.state, reasonCategory: p.reasonCategory, alternativeContentRef: p.alternativeContentRef };
  }
  return result;
}
