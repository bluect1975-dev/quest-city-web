import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString, requireIdempotencyKey, validateOptionalEnumQueryParam } from "../../../lib/staff-validation";
import { parseTargetLearningPath, toTargetLearningPathResponse } from "../../../lib/learning-path-adjustment-request";
import { getFacilitationProposalService } from "../../../lib/staff-identity-context";

const PROPOSAL_TYPE_VALUES = ["FACILITATION", "DIFFICULTY", "LEARNING_PATH_ADJUSTMENT"] as const;

function toResponseData(proposal: {
  publicId: string;
  tenantId: string;
  studentProfileId: string;
  proposalType: string;
  targetCategory: string | null;
  targetResourceType: string | null;
  targetResourceRef: string | null;
  targetRequestedState: string | null;
  targetRequestedAlternativeContentRef: string | null;
  status: string;
  createdAt: Date;
  version: number;
}) {
  return {
    id: proposal.publicId,
    tenantId: proposal.tenantId,
    studentProfileId: proposal.studentProfileId,
    proposalType: proposal.proposalType,
    targetCategory: proposal.targetCategory,
    targetLearningPath: toTargetLearningPathResponse(proposal),
    status: proposal.status,
    createdAt: proposal.createdAt.toISOString(),
    version: proposal.version,
  };
}

/** `POST /asacom/facilitation-proposals` (02_26 v1.16 §37.7, capability asacom.facilitation.propose/.difficulty.propose; LEARNING_PATH_ADJUSTMENT reuses .facilitation.propose, 02_41 §22, no new capability). */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const studentPublicId = validateNonEmptyString(body.studentPublicId, "studentPublicId");
    const proposalType = validateOptionalEnumQueryParam(typeof body.proposalType === "string" ? body.proposalType : null, PROPOSAL_TYPE_VALUES, "proposalType");
    if (!proposalType) {
      throw new StaffIdentityError("VALIDATION_ERROR", "proposalType is required.");
    }
    const targetCategory = typeof body.targetCategory === "string" ? body.targetCategory : null;
    const descriptionStructuredRef = typeof body.descriptionStructuredRef === "string" ? body.descriptionStructuredRef : null;
    const targetLearningPath = parseTargetLearningPath(body);

    const created = await getFacilitationProposalService().create({
      identity, studentPublicId, proposalType, targetCategory, descriptionStructuredRef, targetLearningPath, idempotencyKey,
    });

    return NextResponse.json(
      { data: toResponseData(created), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
