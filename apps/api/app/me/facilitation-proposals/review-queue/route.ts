import { NextResponse } from "next/server";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { validateStaffPaginationQuery, validateOptionalEnumQueryParam } from "../../../../lib/staff-validation";
import { getFacilitationProposalService } from "../../../../lib/staff-identity-context";

const STATUS_VALUES = ["SUBMITTED", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;

/**
 * `GET /me/facilitation-proposals/review-queue` (`contracts/quest-city-platform-openapi-v1_14.yaml`,
 * 02_26 v1.17 §38.2). No new capability -- reuses the review authorization
 * already established for `POST .../review`. Self-authored proposals are
 * always excluded (anti-self-approval applied at read time too).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);
    const status = validateOptionalEnumQueryParam(url.searchParams.get("status"), STATUS_VALUES, "status") ?? "SUBMITTED";

    const items = await getFacilitationProposalService().myReviewQueue(identity, status, pagination);

    return NextResponse.json(
      {
        data: items.map((proposal) => ({
          id: proposal.publicId,
          tenantId: proposal.tenantId,
          studentProfileId: proposal.studentProfileId,
          proposedByStaffAccountId: proposal.proposedByStaffAccountId,
          proposalType: proposal.proposalType,
          targetCategory: proposal.targetCategory,
          status: proposal.status,
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
