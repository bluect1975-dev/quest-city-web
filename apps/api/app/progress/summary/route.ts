import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../lib/identity-context";
import { getLearningAttemptRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /progress/summary` (02_26 v1.6 §18.4). Student-scoped only in this
 * version: always the authenticated student's own aggregate — no staff
 * authentication exists to authorize a broader dashboard query (see the
 * OpenAPI v1.4 path description). Filters narrow within that scope.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);

    const url = new URL(request.url);
    const runtimeChannel = url.searchParams.get("runtimeChannel");
    const reconciliationStatus = url.searchParams.get("reconciliationStatus");
    const technicalVersion = url.searchParams.get("technicalVersion");

    const filters: Parameters<ReturnType<typeof getLearningAttemptRepository>["summarizeForStudent"]>[2] = {};
    if (runtimeChannel) filters.runtimeChannel = runtimeChannel as never;
    if (reconciliationStatus) filters.reconciliationStatus = reconciliationStatus as never;
    if (technicalVersion) filters.technicalVersion = technicalVersion;

    const summary = await getLearningAttemptRepository().summarizeForStudent(
      identity.tenantId,
      identity.studentProfileId,
      filters,
    );

    return NextResponse.json(
      {
        data: {
          studentPublicId: identity.studentProfileId,
          aggregate: summary,
          filtersApplied: {
            runtimeChannel: runtimeChannel ?? undefined,
            reconciliationStatus: reconciliationStatus ?? undefined,
            technicalVersion: technicalVersion ?? undefined,
          },
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
