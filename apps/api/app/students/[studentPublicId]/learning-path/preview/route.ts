import { NextResponse } from "next/server";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { getLearningPathPolicyService } from "../../../../../lib/staff-identity-context";

/** `GET /students/{studentPublicId}/learning-path/preview` (OpenAPI v1.15.0 getStudentLearningPathPreview, 02_41 §32, mission §33-34 "Che cosa vedrà questo studente?"). */
export async function GET(request: Request, { params }: { params: Promise<{ studentPublicId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { studentPublicId } = await params;

    const nodes = await getLearningPathPolicyService().previewStudent(identity, studentPublicId);

    return NextResponse.json(
      {
        data: {
          studentPublicId,
          nodes: nodes.map((n) => ({ ...n, sourcePolicyId: n.sourcePolicyId ?? undefined, alternativeContentVersion: n.alternativeContentRef ?? undefined, reasonCategory: n.reasonCategory ?? undefined })),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
