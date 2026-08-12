import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { validateStaffPaginationQuery } from "../../../lib/staff-validation";
import { getStaffMembershipService, getStaffAccountRepository } from "../../../lib/staff-identity-context";

/** `GET /staff/members` (02_35 v1.2 §11bis.4). SCHOOL_ADMIN-only (staff.member.read) — lists every membership in the tenant, including INVITED/non-ACTIVE rows. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { limit, offset } = validateStaffPaginationQuery(new URL(request.url));

    const accounts = getStaffAccountRepository();
    const emailCache = new Map<string, string>();
    const members = await getStaffMembershipService().list(identity, {
      limit,
      offset,
      emailByAccountId: async (staffAccountId: string) => {
        const cached = emailCache.get(staffAccountId);
        if (cached) return cached;
        const account = await accounts.findById(staffAccountId);
        const email = account?.email ?? "";
        emailCache.set(staffAccountId, email);
        return email;
      },
    });

    return NextResponse.json(
      {
        data: members,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
