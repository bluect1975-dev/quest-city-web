import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";

export type FacilitationProposalType = "FACILITATION" | "DIFFICULTY";
export type FacilitationProposalStatus = "SUBMITTED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";

export interface FacilitationProposal {
  id: string;
  publicId: string;
  tenantId: string;
  studentProfileId: string;
  proposedByStaffAccountId: string;
  proposalType: FacilitationProposalType;
  targetCategory: string | null;
  descriptionStructuredRef: string | null;
  status: FacilitationProposalStatus;
  reviewedByStaffAccountId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  version: number;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  student_profile_id: string;
  proposed_by_staff_account_id: string;
  proposal_type: FacilitationProposalType;
  target_category: string | null;
  description_structured_ref: string | null;
  status: FacilitationProposalStatus;
  reviewed_by_staff_account_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  version: number;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, student_profile_id, proposed_by_staff_account_id, proposal_type,
  target_category, description_structured_ref, status, reviewed_by_staff_account_id, reviewed_at, review_note, created_at, version`;

function mapRow(row: Row): FacilitationProposal {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    studentProfileId: row.student_profile_id,
    proposedByStaffAccountId: row.proposed_by_staff_account_id,
    proposalType: row.proposal_type,
    targetCategory: row.target_category,
    descriptionStructuredRef: row.description_structured_ref,
    status: row.status,
    reviewedByStaffAccountId: row.reviewed_by_staff_account_id,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    version: row.version,
  };
}

/**
 * `facilitation_proposal` (02_25 v1.12 §6.16.2, 02_39 §11) -- one shared
 * model for both FACILITATION and DIFFICULTY proposals. Anti-self-approval
 * (`reviewed_by_staff_account_id <> proposed_by_staff_account_id`) is
 * already enforced by a DB CHECK (migration 0012) -- this repository does
 * not re-implement it, only surfaces the resulting constraint violation.
 */
export class FacilitationProposalRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<FacilitationProposal | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM facilitation_proposal WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByPublicId(publicId: string, tenantId: string): Promise<FacilitationProposal | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM facilitation_proposal WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** `GET /facilitation-proposals` (02_26 v1.16 §37.7) -- the author's own proposals, any status. */
  async findByAuthor(proposedByStaffAccountId: string, tenantId: string, pagination: { limit: number; offset: number }): Promise<FacilitationProposal[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM facilitation_proposal
       WHERE proposed_by_staff_account_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [proposedByStaffAccountId, tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  async findByStudent(studentProfileId: string, tenantId: string, pagination: { limit: number; offset: number }): Promise<FacilitationProposal[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM facilitation_proposal
       WHERE student_profile_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [studentProfileId, tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  /**
   * `GET /me/facilitation-proposals/review-queue` (02_26 v1.17 §38.2) --
   * every SUBMITTED (or explicitly requested other status) proposal for
   * the given set of student_profile_ids the caller may review (resolved
   * by the service layer from support_student_assignment/staff_class_assignment
   * scope), excluding the caller's own authored proposals (anti-self-approval
   * applied at read time too, not only at the review mutation).
   */
  async findReviewQueue(
    tenantId: string,
    reviewerStaffAccountId: string,
    reviewableStudentProfileIds: string[],
    status: FacilitationProposalStatus,
    pagination: { limit: number; offset: number },
  ): Promise<FacilitationProposal[]> {
    if (reviewableStudentProfileIds.length === 0) {
      return [];
    }
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM facilitation_proposal
       WHERE tenant_id = $1 AND status = $2 AND student_profile_id = ANY($3::uuid[]) AND proposed_by_staff_account_id <> $4
       ORDER BY created_at ASC LIMIT $5 OFFSET $6`,
      [tenantId, status, reviewableStudentProfileIds, reviewerStaffAccountId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  async create(input: {
    tenantId: string;
    studentProfileId: string;
    proposedByStaffAccountId: string;
    proposalType: FacilitationProposalType;
    targetCategory?: string | null;
    descriptionStructuredRef?: string | null;
  }): Promise<FacilitationProposal> {
    const publicId = `fap_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO facilitation_proposal
         (public_id, tenant_id, student_profile_id, proposed_by_staff_account_id, proposal_type, target_category, description_structured_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        publicId,
        input.tenantId,
        input.studentProfileId,
        input.proposedByStaffAccountId,
        input.proposalType,
        input.targetCategory ?? null,
        input.descriptionStructuredRef ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /**
   * `POST /facilitation-proposals/{id}/review` -- optimistic concurrency
   * via If-Match/version (same pattern as teacher_feedback,
   * review_queue_item). Returns null on version mismatch or
   * non-SUBMITTED status. `publicId` -- every id this package exposes
   * across a service/API boundary is the public_id, never the raw
   * internal UUID (found the hard way: a prior version of this method
   * filtered on the raw `id` column and every caller passed publicId,
   * producing a Postgres `invalid input syntax for type uuid` on every
   * real review/withdraw attempt -- caught during the live browser
   * walkthrough, not by any of the mocked/service-level tests).
   */
  async review(
    publicId: string,
    tenantId: string,
    expectedVersion: number,
    decision: "ACCEPTED" | "REJECTED",
    reviewedByStaffAccountId: string,
    reviewNote: string | null,
  ): Promise<FacilitationProposal | null> {
    const result = await this.db.query<Row>(
      `UPDATE facilitation_proposal
       SET status = $4, reviewed_by_staff_account_id = $5, reviewed_at = now(), review_note = $6, version = version + 1
       WHERE public_id = $1 AND tenant_id = $2 AND version = $3 AND status = 'SUBMITTED' AND proposed_by_staff_account_id <> $5
       RETURNING ${SELECT_COLUMNS}`,
      [publicId, tenantId, expectedVersion, decision, reviewedByStaffAccountId, reviewNote],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** `POST /facilitation-proposals/{id}/withdraw` -- author-only, only while SUBMITTED. `publicId`, see note on `review()` above. */
  async withdraw(publicId: string, tenantId: string, proposedByStaffAccountId: string): Promise<FacilitationProposal | null> {
    const result = await this.db.query<Row>(
      `UPDATE facilitation_proposal
       SET status = 'WITHDRAWN', version = version + 1
       WHERE public_id = $1 AND tenant_id = $2 AND proposed_by_staff_account_id = $3 AND status = 'SUBMITTED'
       RETURNING ${SELECT_COLUMNS}`,
      [publicId, tenantId, proposedByStaffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
