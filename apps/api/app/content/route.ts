import { NextResponse } from "next/server";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { getContentBundleRepository } from "../../lib/attempts-context";

/**
 * `GET /content` (Pilot Product Experience Remediation Tranche G7,
 * `UX-CONTENT-ASSIGNMENT-01`) — real content catalog for the teacher
 * assignment picker, replacing the raw `contentBundleId` text field. Any
 * authenticated staff member may list it: `content_bundle` is GLOBAL, not
 * tenant-scoped, so there is no narrower authorization to apply here — the
 * same scope the raw-ID field already implicitly allowed (whoever knew an
 * id could assign it). Optional `subjectId` query filter matches the exact
 * stored code (e.g. `MAT`) — there is no lookup table to validate it
 * against or to translate it to a display name (`NEW-GAP-CONTENT-BUNDLE-NO-TITLE-01`).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    await requireStaffIdentity(request, env);

    const url = new URL(request.url);
    const subjectId = url.searchParams.get("subjectId");

    const bundles = await getContentBundleRepository().findPublishedForWebRuntime(subjectId ? { subjectId } : {});

    const data = bundles.map((bundle) => ({
      contentBundleId: bundle.publicId,
      subjectId: bundle.subjectId,
      bundleType: bundle.bundleType,
      bundleVersion: bundle.bundleVersion,
      publishedAt: bundle.publishedAt?.toISOString() ?? null,
    }));

    return NextResponse.json(
      { data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
