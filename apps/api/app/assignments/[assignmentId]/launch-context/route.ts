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
      // GLPC effective-availability gate (02_41 v1.2 §41-bis, 07_15_01 v1.4
      // §15.2-ter, contracts v1.16.0): resolved and enforced BEFORE any
      // learning_attempt row is created and BEFORE any learning_path_snapshot
      // is captured. Only reached for a genuinely new attempt -- `existing`
      // (above) already short-circuits a resume to reuse the prior row, so
      // an attempt already ACTIVE under its own immutable snapshot is never
      // retroactively denied here (finish-current-attempt, 02_41 §34); this
      // gate applies only to a fresh launch/subsequent session.
      // `bundle.publicId` stands in for a UNIT_ELEMENT resourceRef by the
      // same disclosed convention already documented elsewhere in this
      // route -- no assignment_target/content_entity_index table exists in
      // this schema (migration 0013 header) -- no second target-resolution
      // mechanism introduced here.
      const resolvedAvailability = await resolveEffectiveForLaunchAttempt({
        tenantId: identity.tenantId,
        studentProfileId: identity.studentProfileId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: bundle.publicId,
      });

      if (resolvedAvailability.effectiveAvailability === "EFFECTIVE_UNAVAILABLE") {
        // Reuses the existing GLPC error code (02_41 §46) rather than
        // minting a second CROSS_RUNTIME-domain synonym (02_41 §48-ter) --
        // constructed inline (matching the other non-CrossRuntimeError
        // envelopes above in this same file) rather than extending
        // CROSS_RUNTIME_ERROR_CODES, which stays fixed at its 8 native
        // values (07_15_01 v1.4 §14 note) -- domain is CROSS_RUNTIME only
        // by section-location convention (02_26 v1.20 §18.7), not because
        // the code is CROSS_RUNTIME-native. No attempt row is created, no
        // snapshot is captured -- no partial/orphan state, and the
        // creation-idempotency key stays unconsumed for a future retry
        // once/if the policy changes.
        return NextResponse.json(
          {
            domain: "CROSS_RUNTIME",
            code: "LEARNING_PATH_RESOURCE_NOT_AVAILABLE",
            httpStatus: 409,
            message: "Questa risorsa non è attualmente disponibile nel tuo percorso di apprendimento.",
            correlationId: correlationId ?? "",
            retryable: false,
          },
          { status: 409 },
        );
      }

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

      // GLPC (02_41 §33-34): captured exactly once, at CREATED, never at
      // resume -- reuses the same resolution already used for the gate
      // above (no second resolver call). Persistence of the snapshot row
      // itself remains best-effort/non-blocking: the gating decision has
      // already been made and enforced above, so a snapshot-*write*
      // failure must never retroactively revoke an attempt the student is
      // already entitled to -- it is logged, not thrown.
      try {
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
