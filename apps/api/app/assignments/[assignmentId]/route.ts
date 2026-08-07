import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /assignments/{assignmentId}` (02_26 v1.6 §18.1). Read-only — no
 * public create/update endpoint exists for assignments (AGENTS.md v4.30
 * §4.21 rule 16). Session cookie only, no CSRF (read with no side effect).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const { assignmentId } = await params;
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const assignment = await getAssignmentRepository().findByIdAndTenant(assignmentId, identity.tenantId);
    if (!assignment) {
      return notFound(correlationId, assignmentId);
    }

    return NextResponse.json(
      {
        data: {
          assignmentId: assignment.id,
          title: assignment.title,
          status: assignment.status,
          opensAt: assignment.opensAt?.toISOString() ?? null,
          dueAt: assignment.dueAt?.toISOString() ?? null,
          allowedRuntimeChannels: assignment.allowedRuntimeChannels,
          completionPolicy: assignment.completionPolicy,
          contentBundleId: assignment.contentBundleId,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

function notFound(correlationId: string | null, assignmentId: string): NextResponse {
  return NextResponse.json(
    {
      domain: "PLATFORM",
      code: "RESOURCE_NOT_FOUND",
      httpStatus: 404,
      message: `Assignment ${assignmentId} not found`,
      correlationId: correlationId ?? "",
      retryable: false,
    },
    { status: 404 },
  );
}
