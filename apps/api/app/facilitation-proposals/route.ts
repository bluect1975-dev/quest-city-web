import { NextResponse } from "next/server";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { validateStaffPaginationQuery } from "../../lib/staff-validation";
import { getFacilitationProposalService } from "../../lib/staff-identity-context";

/**
 * `GET /facilitation-proposals` (02_26 v1.16 §37.7) -- the caller's own
 * authored proposals (any status) by default. An optional
 * `studentPublicId` query param switches to the scope-based list for a
 * specific student (TEACHER/SUPPORT_TEACHER with access to that
 * student's support scope) -- both uses share one endpoint, per the
 * contract's own description ("capability di proposta per l'autore, o
 * accesso TEACHER/SUPPORT_TEACHER con scope sullo studente").
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);
    const studentPublicId = url.searchParams.get("studentPublicId");

    const items = studentPublicId
      ? await getFacilitationProposalService().listByStudent(identity, studentPublicId, pagination)
      : await getFacilitationProposalService().listByAuthor(identity, pagination);

    return NextResponse.json(
      {
        data: items.map((proposal) => ({
          id: proposal.publicId,
          studentProfileId: proposal.studentProfileId,
          proposalType: proposal.proposalType,
          targetCategory: proposal.targetCategory,
          status: proposal.status,
          reviewedAt: proposal.reviewedAt ? proposal.reviewedAt.toISOString() : null,
          reviewNote: proposal.reviewNote,
          createdAt: proposal.createdAt.toISOString(),
          version: proposal.version,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
