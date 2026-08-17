import { NextResponse } from "next/server";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getFacilitationService } from "../../../../lib/staff-identity-context";

/** `GET /students/{studentPublicId}/facilitation` (02_26 v1.16 §37.6) -- projects support_profile (02_39 §7.1), filtered to the caller's own scope. */
export async function GET(request: Request, { params }: { params: Promise<{ studentPublicId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { studentPublicId } = await params;

    const entries = await getFacilitationService().readByStudent(identity, studentPublicId);

    return NextResponse.json(
      {
        data: entries.map((entry) => ({
          category: entry.category,
          level: entry.level,
          configJson: entry.configJson,
          appliedByRole: entry.appliedByRole,
          expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
          updatedAt: entry.updatedAt.toISOString(),
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
