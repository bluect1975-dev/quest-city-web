import { NextResponse } from "next/server";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { getLearningPathPolicyService } from "../../../../../lib/staff-identity-context";

/** `GET /classes/{classId}/learning-path/preview` (OpenAPI v1.15.0 getClassLearningPathPreview, 02_41 §32, mission §33-34). */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;

    const nodes = await getLearningPathPolicyService().previewClass(identity, classId);

    return NextResponse.json(
      {
        data: { classId, nodes: nodes.map((n) => ({ ...n, sourcePolicyId: n.sourcePolicyId ?? undefined, alternativeContentVersion: n.alternativeContentRef ?? undefined, reasonCategory: n.reasonCategory ?? undefined })) },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
