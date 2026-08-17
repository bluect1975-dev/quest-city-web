import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { CrossRuntimeError, RuntimeCapabilityResolver } from "@quest-city-web/attempts";
import { resolvePresentationLocale } from "@quest-city-web/i18n";
import { createLogger } from "@quest-city-web/telemetry";
import { getSessionService, getTenantRepository } from "../../../../lib/identity-context";
import {
  getAssignmentRepository,
  getContentBundleRepository,
  getLearningAttemptRepository,
  getLearningPathSnapshotRepository,
  resolveEffectiveForLaunchAttempt,
} from "../../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../../lib/attempt-error-response";
import { readSessionToken } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";

interface LaunchContextRequestBody {
  runtimeChannel?: "WEB" | "ROBLOX";
  runtimeVersion?: string;
  presentationAdapterVersion?: string;
  themeId?: string;
  presentationLocale?: string;
}

/**
 * `POST /assignments/{assignmentId}/launch-context` (02_26 v1.6 §18.2).
 * Creates or resumes a learning attempt. `Idempotency-Key` scopes
 * CREATION only (learning_attempt.creation_idempotency_key) — distinct
 * from the completion-scope key on the complete endpoint.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const { assignmentId } = await params;
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    const csrfToken = getCsrfTokenHeader(request);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    if (!isTrustedOrigin(request, env) || !csrfToken) {
      throw new IdentityError("CSRF_INVALID");
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new IdentityError("VALIDATION_ERROR", "Idempotency-Key header is required (min 16 chars)");
    }

    const body = (await request.json().catch(() => ({}))) as LaunchContextRequestBody;
    if (body.runtimeChannel !== "WEB" && body.runtimeChannel !== "ROBLOX") {
      throw new IdentityError("VALIDATION_ERROR", "runtimeChannel must be WEB or ROBLOX");
    }

    // presentationLocale (WEB-I18N-FOUNDATION I18N-A/B, contracts v1.5,
    // 07_15_01 v1.2 §15.2-bis): a malformed value is rejected here, before
    // any attempt state is created or mutated -- never silently treated as
    // absent. Absent/unsupported are NOT errors and are resolved further
    // down, once the tenant (school-level hierarchy input) is available.
    const localeSyntaxCheck = resolvePresentationLocale(body.presentationLocale, {});
    if (!localeSyntaxCheck.ok) {
      return NextResponse.json(
        {
          domain: "PLATFORM",
          code: "VALIDATION_ERROR",
          httpStatus: 400,
          message: "presentationLocale is not a syntactically valid locale tag.",
          correlationId: correlationId ?? "",
          retryable: false,
          safeDetails: { field: "presentationLocale" },
        },
        { status: 400 },
      );
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const assignments = getAssignmentRepository();
    const attempts = getLearningAttemptRepository();
    const bundles = getContentBundleRepository();

    const assignment = await assignments.findByIdAndTenant(assignmentId, identity.tenantId);
    if (!assignment) {
      return NextResponse.json(
        { domain: "PLATFORM", code: "RESOURCE_NOT_FOUND", httpStatus: 404, message: "Assignment not found", correlationId: correlationId ?? "", retryable: false },
        { status: 404 },
      );
    }

    // §5.3 validation order: allowedRuntimeChannels first.
    if (!assignment.allowedRuntimeChannels.includes(body.runtimeChannel)) {
      throw new CrossRuntimeError(
        "RUNTIME_CHANNEL_NOT_ALLOWED",
        "Il runtime dichiarato non è ammesso per questa assegnazione.",
      );
    }

    // Creation-idempotency lookup — a replay returns the existing attempt,
    // never a second row (07_15_01 v1.1 §10.1).
    const existing = await attempts.findByCreationKey(
      identity.tenantId,
      assignmentId,
      identity.studentProfileId,
      idempotencyKey,
    );

    const bundle = await bundles.findById(assignment.contentBundleId);
    if (!bundle) {
      throw new CrossRuntimeError("PRESENTATION_ADAPTER_UNAVAILABLE", "Content bundle not found for assignment");
    }

    // No presentation-adapter registry exists yet (07_08 defines the
    // adapter *model*, not a DB-backed registry — out of WEB-M2 scope;
    // `content_bundle` stores `manifest_hash`/`storage_ref`, not a
    // capabilityRequirements column, so loading the real manifest here
    // would need the full bundle-loading pipeline, also out of scope).
    // RuntimeCapabilityResolver is exercised against a single static
    // adapter per runtime — the resolver's own algorithm is generic and
    // exercised with multiple simulated combinations in
    // runtime-capability-resolver.test.ts. The capabilities below are the
    // real, known requirements of the one content bundle this milestone
    // actually has (Balance Machine RUNTIME_FIXTURE_BUNDLE,
    // packages/test-fixtures/src/balance-machine-fixture.ts
    // capabilityRequirements) — not an empty, vacuously-always-true set.
    const resolver = new RuntimeCapabilityResolver();
    const resolution = resolver.resolve({
      runtimeChannel: body.runtimeChannel,
      requestedCapabilities: ["html", "keyboard"],
      availableAdapters: [
        {
          adapterId: `default-${body.runtimeChannel.toLowerCase()}-adapter`,
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: [body.runtimeChannel],
          supportedCapabilities: ["html", "keyboard"],
        },
      ],
    });
    if (!resolution.compatible) {
      // RuntimeCapabilityResolver's reasons are 07_08-flavoured
      // (CAPABILITY_MISSING / PRESENTATION_ADAPTER_UNAVAILABLE); mapped
      // here to the CROSS_RUNTIME vocabulary (07_15_01 v1.1 §14 uses
      // RUNTIME_CAPABILITY_MISMATCH, not CAPABILITY_MISSING).
      const code = resolution.reason === "CAPABILITY_MISSING" ? "RUNTIME_CAPABILITY_MISMATCH" : "PRESENTATION_ADAPTER_UNAVAILABLE";
      throw new CrossRuntimeError(code, "No compatible presentation adapter for this runtime.");
    }

    // presentationLocale resolution (02_34 §3-4, 07_15_01 v1.2 §15.2-bis):
    // school level reads tenant.settings_json.locale; student/class levels
    // are reserved, not persisted in this milestone. Malformed input was
    // already rejected above; this call always succeeds (`ok: true`) here.
    const tenant = await getTenantRepository().findById(identity.tenantId);
    const schoolLocale = tenant?.settingsJson.locale;
    const localeResolution = resolvePresentationLocale(body.presentationLocale, {
      schoolLocale: typeof schoolLocale === "string" ? schoolLocale : null,
    });
    const presentationLocale = localeResolution.ok ? localeResolution.resolved : "it-IT";

    let attempt = existing;
    if (!attempt) {
      attempt = await attempts.create({
        tenantId: identity.tenantId,
        eventId: randomUUID(),
        assignmentId,
        studentProfileId: identity.studentProfileId,
        enrollmentId: identity.enrollmentId,
        contentBundleId: bundle.id,
        contentId: bundle.id,
        contentVersion: bundle.bundleVersion,
        runtimeChannel: body.runtimeChannel,
        runtimeVersion: body.runtimeVersion ?? null,
        presentationAdapterVersion: resolution.adapter.adapterVersion,
        themeId: body.themeId ?? null,
        creationIdempotencyKey: idempotencyKey,
      });

      // GLPC (02_41 §33-34, mission §25-29): captured exactly once, at
      // CREATED, never at resume -- a resumed attempt keeps using its own
      // original snapshot (finish-current-attempt, §23), so this branch
      // only runs for a genuinely new attempt row. Best-effort: a
      // snapshot-capture failure must never block the attempt the student
      // is otherwise entitled to continue, so it is logged, not thrown.
      // `bundle.publicId` stands in for a UNIT_ELEMENT resourceRef by
      // convention -- no curriculum_profile/content_entity_index table
      // exists in this schema to derive a true curriculum-node id from an
      // assignment's content_bundle (migration 0013 header); this is the
      // same disclosed opaque-identity gap, applied at the one place a
      // learning_attempt actually gets created.
      try {
        const resolvedAvailability = await resolveEffectiveForLaunchAttempt({
          tenantId: identity.tenantId,
          studentProfileId: identity.studentProfileId,
          resourceType: "UNIT_ELEMENT",
          resourceRef: bundle.publicId,
        });
        await getLearningPathSnapshotRepository().capture({
          tenantId: identity.tenantId,
          learningAttemptId: attempt.id,
          resolvedAvailability,
        });
      } catch (snapshotError) {
        createLogger(correlationId ?? undefined).error("learning_path_snapshot capture failed", {
          message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
        });
      }
    }

    return NextResponse.json(
      {
        data: {
          attempt: {
            attemptId: attempt.id,
            assignmentId: attempt.assignmentId,
            attemptState: attempt.attemptState,
            completionStatus: attempt.completionStatus,
            runtimeChannel: attempt.runtimeChannel,
            startedAt: attempt.startedAt.toISOString(),
            completedAt: attempt.completedAt?.toISOString() ?? null,
          },
          bundle: { contentBundleId: bundle.id, bundleVersion: bundle.bundleVersion },
          adapter: { adapterId: resolution.adapter.adapterId, adapterVersion: resolution.adapter.adapterVersion },
          completionPolicy: assignment.completionPolicy,
          presentationLocale,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
