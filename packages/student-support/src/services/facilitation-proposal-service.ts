import type { Pool } from "pg";
import { AuditRepository, StudentProfileRepository, SchoolEnrollmentRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError, isClassInScope, assertStaffCapability, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { SupportStudentAssignmentRepository } from "../repository/support-student-assignment-repository";
import {
  FacilitationProposalRepository,
  type FacilitationProposal,
  type FacilitationProposalType,
  type FacilitationProposalStatus,
} from "../repository/facilitation-proposal-repository";
import { SupportProfileRepository, type SupportProfileCategory } from "../repository/support-profile-repository";
import { DifficultyOverrideRepository } from "../repository/difficulty-override-repository";
import { resolveStudentSupportScope, assertStudentSupportScope } from "./support-scope";

const SUPPORT_PROFILE_CATEGORIES: readonly string[] = ["PRESENTATION", "TIME_AND_LOAD", "TOOLS", "RESPONSE", "FEEDBACK", "ASSESSMENT", "SUBJECT"];

const IDEMPOTENCY_SCOPE = "facilitation_proposal_create";
const REVIEW_IDEMPOTENCY_SCOPE = "facilitation_proposal_review";

/**
 * `POST /asacom/facilitation-proposals`, `POST
 * /support-teacher/facilitation-proposals`, `GET /facilitation-proposals`,
 * `POST .../review`, `POST .../withdraw`, `GET
 * /me/facilitation-proposals/review-queue` (02_26 v1.16 §37.7, v1.17
 * §38.2). One shared model for FACILITATION and DIFFICULTY proposals
 * (02_39 §11). Reviewer resolution (§6ter/§42): the assigned
 * SUPPORT_TEACHER if present, otherwise the class TEACHER -- never a
 * manual reviewer choice, never a forced hierarchy when the
 * higher-authority role is already available. Anti-self-approval is
 * enforced by the DB CHECK (migration 0012) as the final backstop, but
 * this service also refuses the review attempt earlier with a clear
 * STAFF_FORBIDDEN, and excludes self-authored proposals from the review
 * queue at read time too.
 */
export class FacilitationProposalService {
  private readonly proposals: FacilitationProposalRepository;
  private readonly assignments: SupportStudentAssignmentRepository;
  private readonly enrollments: SchoolEnrollmentRepository;
  private readonly students: StudentProfileRepository;
  private readonly profiles: SupportProfileRepository;
  private readonly difficultyOverrides: DifficultyOverrideRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.proposals = new FacilitationProposalRepository(pool);
    this.assignments = new SupportStudentAssignmentRepository(pool);
    this.enrollments = new SchoolEnrollmentRepository(pool);
    this.students = new StudentProfileRepository(pool);
    this.profiles = new SupportProfileRepository(pool);
    this.difficultyOverrides = new DifficultyOverrideRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    studentPublicId: string;
    proposalType: FacilitationProposalType;
    targetCategory?: string | null;
    descriptionStructuredRef?: string | null;
    idempotencyKey: string;
  }): Promise<FacilitationProposal> {
    const { identity } = input;
    if (identity.role === "ASACOM") {
      assertStaffCapability(identity, input.proposalType === "DIFFICULTY" ? "asacom.difficulty.propose" : "asacom.facilitation.propose");
    } else if (identity.role === "SUPPORT_TEACHER") {
      // SUPPORT_TEACHER proposes only for students NOT their own (02_39
      // §11: for own assigned students they have direct APPLY authority
      // instead -- proposing to oneself would be a pointless detour).
      const ownAssignment = await this.assignments.findActiveByMembershipAndStudent(
        identity.staffTenantMembershipId,
        (await this.requireStudent(identity, input.studentPublicId)).id,
        identity.tenantId,
      );
      if (ownAssignment) {
        throw new StaffIdentityError(
          "VALIDATION_ERROR",
          "SUPPORT_TEACHER has direct apply authority for own assigned students -- propose only for non-assigned students (02_39 §11).",
        );
      }
      assertStaffCapability(identity, input.proposalType === "DIFFICULTY" ? "support_teacher.difficulty.apply" : "support_teacher.facilitation.apply");
    } else {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "TEACHER never proposes for its own class (02_39 §11).");
    }

    const student = await this.requireStudent(identity, input.studentPublicId);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ studentProfileId: student.id, proposalType: input.proposalType, targetCategory: input.targetCategory ?? null }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as FacilitationProposal;
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
      const created = await this.proposals.create({
        tenantId: identity.tenantId,
        studentProfileId: student.id,
        proposedByStaffAccountId: identity.staffAccountId,
        proposalType: input.proposalType,
        targetCategory: input.targetCategory ?? null,
        descriptionStructuredRef: input.descriptionStructuredRef ?? null,
      });
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: created,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: identity.role === "ASACOM"
          ? input.proposalType === "DIFFICULTY" ? "asacom.difficulty_proposed" : "asacom.facilitation_proposed"
          : input.proposalType === "DIFFICULTY" ? "support_teacher.difficulty_proposed" : "support_teacher.facilitation_proposed",
        targetType: "facilitation_proposal",
        targetId: created.id,
        result: "SUCCESS",
      });
      return created;
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

  /** `GET /facilitation-proposals` -- the caller's own authored proposals. */
  async listByAuthor(identity: StaffInternalIdentity, pagination: { limit: number; offset: number }): Promise<FacilitationProposal[]> {
    const proposals = await this.proposals.findByAuthor(identity.staffAccountId, identity.tenantId, pagination);
    return this.withPublicStudentIds(proposals, identity.tenantId);
  }

  async listByStudent(identity: StaffInternalIdentity, studentPublicId: string, pagination: { limit: number; offset: number }): Promise<FacilitationProposal[]> {
    const student = await this.requireStudentInScope(identity, studentPublicId);
    const proposals = await this.proposals.findByStudent(student.id, identity.tenantId, pagination);
    return proposals.map((p) => ({ ...p, studentProfileId: student.studentPublicId }));
  }

  /**
   * `FacilitationProposal.studentProfileId` (contract shape, unchanged
   * field name) must never carry the raw internal UUID out to a client --
   * same public_id discipline as every other id-shaped field in this
   * package. Resolved in one batched query per call rather than N+1.
   */
  private async withPublicStudentIds(proposals: FacilitationProposal[], tenantId: string): Promise<FacilitationProposal[]> {
    const uniqueIds = [...new Set(proposals.map((p) => p.studentProfileId))];
    const students = await this.students.findByIds(uniqueIds, tenantId);
    const publicIdByProfileId = new Map(students.map((s) => [s.id, s.studentPublicId]));
    return proposals.map((p) => ({ ...p, studentProfileId: publicIdByProfileId.get(p.studentProfileId) ?? p.studentProfileId }));
  }

  /**
   * `GET /me/facilitation-proposals/review-queue` (02_26 v1.17 §38.2) --
   * every SUBMITTED (or explicitly requested status) proposal the caller
   * may review: TEACHER's own class students, or SUPPORT_TEACHER's own
   * ACTIVE support_student_assignment students. Self-authored proposals
   * never appear (repository query excludes them at read time).
   */
  async myReviewQueue(
    identity: StaffInternalIdentity,
    status: FacilitationProposalStatus,
    pagination: { limit: number; offset: number },
  ): Promise<FacilitationProposal[]> {
    const reviewableStudentIds = await this.resolveReviewableStudentProfileIds(identity);
    const proposals = await this.proposals.findReviewQueue(identity.tenantId, identity.staffAccountId, reviewableStudentIds, status, pagination);
    return this.withPublicStudentIds(proposals, identity.tenantId);
  }

  /** `POST /facilitation-proposals/{id}/review` -- ACCEPT/REJECT, If-Match/version, anti-self-approval, ACCEPT invokes the existing FACILITATION/DIFFICULTY apply mechanisms (no direct write here beyond status). */
  async review(input: {
    identity: StaffInternalIdentity;
    id: string;
    decision: "ACCEPT" | "REJECT";
    reviewNote?: string | null;
    ifMatchVersion: number;
    idempotencyKey: string;
  }): Promise<FacilitationProposal> {
    const { identity } = input;
    const proposal = await this.proposals.findByPublicId(input.id, identity.tenantId);
    if (!proposal) {
      throw new StaffIdentityError("VALIDATION_ERROR", "facilitation_proposal not found.");
    }
    if (proposal.proposedByStaffAccountId === identity.staffAccountId) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "Anti-self-approval: the proposer cannot review their own proposal (02_39 §6ter).");
    }
    const reviewableStudentIds = await this.resolveReviewableStudentProfileIds(identity);
    if (!reviewableStudentIds.includes(proposal.studentProfileId)) {
      throw new StaffIdentityError("VALIDATION_ERROR", "facilitation_proposal not found.");
    }

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: REVIEW_IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: JSON.stringify({ id: input.id, decision: input.decision }),
    });
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
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as FacilitationProposal;
    }

    try {
      const updated = await this.proposals.review(
        input.id,
        identity.tenantId,
        input.ifMatchVersion,
        input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
        identity.staffAccountId,
        input.reviewNote ?? null,
      );
      if (!updated) {
        const current = await this.proposals.findByPublicId(input.id, identity.tenantId);
        if (current && current.version !== input.ifMatchVersion) {
          throw new StaffIdentityError("ETAG_MISMATCH", "facilitation_proposal version mismatch.");
        }
        throw new StaffIdentityError("VALIDATION_ERROR", "facilitation_proposal is not in a reviewable state.");
      }
      // ACCEPT invokes the FACILITATION/DIFFICULTY write mechanisms
      // (02_39 §11): a FACILITATION accept writes a PROFILE_LEVEL
      // support_profile entry (persistent -- the reviewer, TEACHER or
      // SUPPORT_TEACHER, always has PROFILE_LEVEL authority, 02_39 §7.1);
      // a DIFFICULTY accept writes a difficulty_override, motivation
      // taken from the review note (falls back to a fixed audit-trail
      // string if the reviewer left it blank -- reason is NOT NULL at
      // the schema level, 02_39 §7.2). Both are attributed to the
      // REVIEWER (their decision, their authority), never the original
      // proposer. Best-effort only: the proposal's own status transition
      // above already committed and is the source of truth for
      // ACCEPTED/REJECTED -- a failure applying the underlying change is
      // surfaced to the caller but never silently reverts the decision
      // (same "decision is the record" principle already used for
      // review_queue_item transitions).
      if (input.decision === "ACCEPT") {
        if (updated.proposalType === "FACILITATION" && updated.targetCategory && SUPPORT_PROFILE_CATEGORIES.includes(updated.targetCategory)) {
          await this.profiles.apply({
            tenantId: identity.tenantId,
            studentProfileId: updated.studentProfileId,
            category: updated.targetCategory as SupportProfileCategory,
            level: "PROFILE_LEVEL",
            configJson: { fromProposalId: updated.id },
            appliedByStaffAccountId: identity.staffAccountId,
            appliedByRole: identity.role === "SUPPORT_TEACHER" ? "SUPPORT_TEACHER" : "TEACHER",
            expiresAt: null,
          });
        } else if (updated.proposalType === "DIFFICULTY" && identity.role === "SUPPORT_TEACHER") {
          // Disclosed limitation of the minimal difficulty_override model
          // (migration 0012 header note D): its schema ties
          // created_by_role=SUPPORT_TEACHER to the per-student scope --
          // it cannot represent a TEACHER-authored per-student override
          // (only TEACHER's own class-wide scope, which this proposal
          // workflow never targets). When the class TEACHER accepts a
          // DIFFICULTY proposal instead of the assigned SUPPORT_TEACHER,
          // the proposal's own ACCEPTED status is still recorded (the
          // authoritative decision), but no difficulty_override row is
          // written -- the full 02_16/03_28 engine, out of scope here,
          // would be required to represent that case.
          await this.difficultyOverrides.createForStudent({
            tenantId: identity.tenantId,
            studentProfileId: updated.studentProfileId,
            targetRef: updated.targetCategory ?? updated.id,
            reason: input.reviewNote && input.reviewNote.trim().length > 0 ? input.reviewNote : `Accettata da proposta ${updated.publicId}`,
            createdByStaffAccountId: identity.staffAccountId,
          });
        }
      }
      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: REVIEW_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: updated,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "support.proposal_reviewed",
        targetType: "facilitation_proposal",
        targetId: updated.id,
        result: "SUCCESS",
        metadataRedacted: { decision: input.decision },
      });
      return updated;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: REVIEW_IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /** `POST /facilitation-proposals/{id}/withdraw` -- author-only, SUBMITTED-only. */
  async withdraw(identity: StaffInternalIdentity, id: string): Promise<FacilitationProposal> {
    const updated = await this.proposals.withdraw(id, identity.tenantId, identity.staffAccountId);
    if (!updated) {
      throw new StaffIdentityError("VALIDATION_ERROR", "facilitation_proposal not found, not authored by caller, or not SUBMITTED.");
    }
    return updated;
  }

  private async requireStudent(identity: StaffInternalIdentity, studentPublicId: string) {
    const student = await this.students.findByPublicId(studentPublicId);
    if (!student || student.tenantId !== identity.tenantId) {
      throw new StaffIdentityError("SUPPORT_STUDENT_NOT_ASSIGNED");
    }
    return student;
  }

  private async requireStudentInScope(identity: StaffInternalIdentity, studentPublicId: string) {
    const student = await this.requireStudent(identity, studentPublicId);
    const scope = await resolveStudentSupportScope(identity, student.id, { supportAssignments: this.assignments, enrollments: this.enrollments });
    assertStudentSupportScope(scope);
    return student;
  }

  /** Every student_profile_id the caller may review a proposal for: TEACHER's class roster, or SUPPORT_TEACHER's ACTIVE support_student_assignment students. ASACOM never reviews (§39, DENY). */
  private async resolveReviewableStudentProfileIds(identity: StaffInternalIdentity): Promise<string[]> {
    if (identity.role === "SUPPORT_TEACHER") {
      const assignments = await this.assignments.findActiveByMembership(identity.staffTenantMembershipId, identity.tenantId);
      return assignments.map((a) => a.studentProfileId);
    }
    if (identity.role === "TEACHER") {
      const classIds = (identity.classScope ?? []).filter((classId) => isClassInScope(identity, classId));
      const studentIds: string[] = [];
      for (const classId of classIds) {
        const roster = await this.enrollments.findByClass(classId, identity.tenantId);
        studentIds.push(...roster.filter((r) => r.status === "ACTIVE").map((r) => r.studentProfileId));
      }
      return studentIds;
    }
    return [];
  }
}
