import { NextResponse } from "next/server";
import { assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getLearningAttemptRepository } from "../../../../lib/attempts-context";

/**
 * `GET /classes/{classId}/progress` (02_35 §6). Class-level aggregate —
 * diagnostic view over the single `learning_attempt` ledger, never a
 * per-runtime aggregate.
 */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const summary = await getLearningAttemptRepository().summarizeForClass(identity.tenantId, classId);

    return NextResponse.json(
      { data: summary, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
