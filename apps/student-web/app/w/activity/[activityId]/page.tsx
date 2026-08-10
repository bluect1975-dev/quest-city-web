"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import type { EngineSemanticAction } from "@quest-city-web/learning-engines";
import {
  WEB_M4_ACTIVITY_SEQUENCE_DEFINITION,
  WEB_M4_ACTIVITY_STAGE_ID,
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_M4_MAT_M06_ACTIVITY_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
  WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
  WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
  WEB_TRANCHE5_INTRO_HOOK_CONTENT,
  WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
  WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  type SequenceDefinition,
} from "@quest-city-web/content-runtime";
import { SequenceHost } from "../../../../components/engine-host/SequenceHost";
import { useStudentAuth } from "../../../../lib/student-auth-context";
import { completeAttempt, getAttemptActions, launchActivity, submitAction } from "../../../../lib/student-api-client";
import { StudentApiError } from "../../../../lib/student-api-error";

/** Stable per (student session, assignment) creation key — a reload replays it, resuming the same attempt instead of creating a new one. */
function getOrCreateLaunchIdempotencyKey(assignmentId: string): string {
  const storageKey = `qc_web_activity_launch_idem_${assignmentId}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, fresh);
  return fresh;
}

/**
 * `client_sequence` is a Postgres `INTEGER` (`0003_cross_runtime_
 * assignment_and_attempt.sql`), so it must stay within 32-bit signed
 * range — `Date.now()` (13 digits) overflows it and 500s (verified
 * against the real API). A per-component-mount `0, 1, 2, ...` counter
 * also collides with the already-persisted rows after a reload resumes
 * the same attempt (`(attempt_id, client_sequence)` is unique). Persisting
 * the running counter in `sessionStorage`, keyed by `attemptId`, survives
 * the reload the same way the launch idempotency key above already does.
 */
function readNextClientSequence(attemptId: string): number {
  const storageKey = `qc_web_activity_client_sequence_${attemptId}`;
  const stored = window.sessionStorage.getItem(storageKey);
  const next = stored ? Number(stored) + 1 : 0;
  window.sessionStorage.setItem(storageKey, String(next));
  return next;
}

/**
 * One real activity/assignment per real `content_bundle.id` (fixed,
 * seed-time constants — never the assignment's DB row id, which is
 * per-tenant and unknown at build time). `launch-context`'s response
 * already resolves and returns `bundle.contentBundleId` (`packages/
 * content-runtime`'s "renders no engine/orchestrator without a real
 * bundle" precedent) — this registry is the one place `/w/activity/
 * :activityId` decides which real `SequenceDefinition`/engine configs to
 * drive, keyed on that same id, so WEB-M4's own entry is untouched
 * (same definition/config/keys as before Tranche 1) and Tranche 1 only
 * adds a second entry.
 */
interface ActivityRegistryEntry {
  definition: SequenceDefinition;
  stageConfigs: Record<string, unknown>;
  activityId: string;
  runtimeStatePrefix: string;
  titleKey: string;
  descriptionKey: string;
  stagePrompts?: Record<string, { titleKey: string; bodyKey: string }>;
  recapStageId?: string;
  /** M06 Web Full Vertical Slice Tranche 5 (`07_26 v1.1` §13): per-stage semantic roles forwarded to `SequenceHost`'s `stageScenes`. */
  stageScenes?: Record<string, string[]>;
}

const ACTIVITY_REGISTRY: Record<string, ActivityRegistryEntry> = {
  [WEB_M4_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_M4_ACTIVITY_SEQUENCE_DEFINITION,
    stageConfigs: { [WEB_M4_ACTIVITY_STAGE_ID]: WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG },
    activityId: WEB_M4_MAT_M06_ACTIVITY_ID,
    runtimeStatePrefix: "web-m4-runtime",
    titleKey: "activity.sequenceTitle",
    descriptionKey: "activity.sequenceDescription",
  },
  [WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
    stageConfigs: { [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG },
    activityId: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
    runtimeStatePrefix: "web-tranche1-runtime",
    titleKey: "guidedPractice.sequenceTitle",
    descriptionKey: "guidedPractice.sequenceDescription",
    recapStageId: WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
    stagePrompts: {
      [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: { titleKey: "guidedPractice.promptTitle", bodyKey: "guidedPractice.promptEquation" },
    },
  },
  [WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
    stageConfigs: { [WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID]: WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG },
    activityId: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
    runtimeStatePrefix: "web-tranche2-runtime",
    titleKey: "quickQuestionSet.sequenceTitle",
    descriptionKey: "quickQuestionSet.sequenceDescription",
  },
  [WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
    stageConfigs: { [WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID]: WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG },
    activityId: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
    runtimeStatePrefix: "web-tranche3-runtime",
    titleKey: "prerequisiteCheckMicroLesson.sequenceTitle",
    descriptionKey: "prerequisiteCheckMicroLesson.sequenceDescription",
    stagePrompts: WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  },
  [WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION,
    stageConfigs: { [WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID]: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG },
    activityId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
    runtimeStatePrefix: "web-tranche4-runtime",
    titleKey: "interactiveExercise.sequenceTitle",
    descriptionKey: "interactiveExercise.sequenceDescription",
    stagePrompts: {
      [WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID]: { titleKey: "interactiveExercise.promptTitle", bodyKey: "interactiveExercise.promptInstruction" },
    },
  },
  [WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID]: {
    definition: WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
    stageConfigs: {},
    activityId: WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
    runtimeStatePrefix: "web-tranche5-runtime",
    titleKey: "introHook.sequenceTitle",
    descriptionKey: "introHook.sequenceDescription",
    stagePrompts: {
      [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: { titleKey: "introHook.promptTitle", bodyKey: "introHook.promptBody" },
    },
    stageScenes: {
      [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: [...WEB_TRANCHE5_INTRO_HOOK_CONTENT.semanticRoles],
    },
  },
};

/**
 * `/w/activity/:activityId` (WEB-M4, 07_25 v1.0 §7-D/§15; extended M06 Web
 * Full Vertical Slice Tranche 1, `07_26 v1.0` §14). `:activityId` is the
 * assignment's `id` — the same identifier already returned as
 * `assignmentId` by `GET /assignments/{assignmentId}` and consumed by
 * `POST /assignments/{assignmentId}/launch-context` (implementation
 * decision, 07_25 §20 leaves this mapping to implementation time; no
 * separate public/internal split exists for assignments in this codebase
 * — see `apps/api/app/assignments/[assignmentId]/route.ts`).
 *
 * Flow: launch-context creates/resumes the real attempt -> the returned
 * `bundle.contentBundleId` resolves which real `SequenceDefinition` this
 * assignment is (`ACTIVITY_REGISTRY`) -> `SequenceHost` drives the real
 * `EngineHost` against the real config, durably resuming via R3C.3 ->
 * every locally-accepted semantic action is mirrored to
 * `POST /attempts/{attemptId}/actions` -> on sequence completion (both
 * stages for Tranche 1's activity), `POST /attempts/{attemptId}/complete`
 * -> redirect to `/w/result/:attemptId`.
 */
export default function ActivityPage() {
  const params = useParams<{ activityId: string }>();
  const assignmentId = decodeURIComponent(params.activityId);
  const { status, csrfToken } = useStudentAuth();
  const router = useRouter();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [registryEntry, setRegistryEntry] = useState<ActivityRegistryEntry | null>(null);
  const [initialActions, setInitialActions] = useState<EngineSemanticAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastClientSequenceRef = useRef<number | null>(null);
  const completingRef = useRef(false);
  const pendingActionsRef = useRef<Promise<void>[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/w/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || !csrfToken) {
      return;
    }
    let cancelled = false;
    const idempotencyKey = getOrCreateLaunchIdempotencyKey(assignmentId);
    launchActivity(assignmentId, csrfToken, idempotencyKey)
      .then(async (result) => {
        if (cancelled) return;
        const entry = ACTIVITY_REGISTRY[result.bundle.contentBundleId];
        if (!entry) {
          setError(t(STUDENT_WEB_CATALOG_IT_IT, "activity.unknownContentBundle"));
          return;
        }
        setRegistryEntry(entry);
        // Fetched before setAttemptId (which gates SequenceHost's render) so
        // EngineHost mounts with the real prior actions already in hand —
        // resuming mid-interaction rather than a reset-then-replay flash.
        const priorActions = await getAttemptActions(result.attempt.attemptId);
        if (cancelled) return;
        setInitialActions(priorActions.map((action) => ({ ...action })) as EngineSemanticAction[]);
        setAttemptId(result.attempt.attemptId);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [status, csrfToken, assignmentId]);

  function handleAction(action: EngineSemanticAction) {
    if (!attemptId || !csrfToken || !registryEntry) return;
    const clientSequence = readNextClientSequence(attemptId);
    lastClientSequenceRef.current = clientSequence;
    const submitted = submitAction(
      {
        actionId: crypto.randomUUID(),
        attemptId,
        activityId: registryEntry.activityId,
        actionType: action.actionType,
        ...(action.targetRole ? { targetRole: action.targetRole } : {}),
        payload: action.payload,
        clientSequence,
        runtimeChannel: "WEB",
        occurredAt: new Date().toISOString(),
      },
      csrfToken,
    ).catch((caught) => {
      setError(
        caught instanceof StudentApiError
          ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
          : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
      );
    });
    // Tracked so `handleComplete` can await every in-flight action POST
    // before submitting completion — `finalClientSequence` only passes
    // `checkFinalClientSequence` server-side once the matching action row
    // actually exists (avoids a MISSING_ACTION race against the last,
    // still-in-flight CONFIRM_SOLUTION POST).
    pendingActionsRef.current.push(submitted);
  }

  async function handleComplete() {
    if (!attemptId || !csrfToken || completingRef.current) return;
    completingRef.current = true;
    try {
      await Promise.all(pendingActionsRef.current);
      await completeAttempt(attemptId, lastClientSequenceRef.current ?? 0, csrfToken);
      router.push(`/w/result/${encodeURIComponent(attemptId)}`);
    } catch (caught) {
      completingRef.current = false;
      setError(
        caught instanceof StudentApiError
          ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
          : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
      );
    }
  }

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "activity.loading")}</StatusMessage>
      </main>
    );
  }

  if (status === "authenticated-read-only") {
    return (
      <main>
        <StatusMessage kind="unauthorized">{t(STUDENT_WEB_CATALOG_IT_IT, "activity.readOnlySessionBlocked")}</StatusMessage>
        <Link href="/w/login">{t(STUDENT_WEB_CATALOG_IT_IT, "login.title")}</Link>
      </main>
    );
  }

  if (error && (!attemptId || !registryEntry)) {
    return (
      <main>
        <StatusMessage kind="error">{error}</StatusMessage>
        <Link href="/w/home">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
      </main>
    );
  }

  if (!attemptId || !registryEntry || !initialActions) {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "activity.launching")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      {error && <StatusMessage kind="error">{error}</StatusMessage>}
      <SequenceHost
        definition={registryEntry.definition}
        runtimeStateId={`${registryEntry.runtimeStatePrefix}-${attemptId}`}
        initialActions={initialActions}
        stageConfigs={registryEntry.stageConfigs}
        onAction={handleAction}
        onComplete={handleComplete}
        titleKey={registryEntry.titleKey}
        descriptionKey={registryEntry.descriptionKey}
        {...(registryEntry.stagePrompts ? { stagePrompts: registryEntry.stagePrompts } : {})}
        {...(registryEntry.recapStageId ? { recapStageId: registryEntry.recapStageId } : {})}
        {...(registryEntry.stageScenes ? { stageScenes: registryEntry.stageScenes } : {})}
      />
    </main>
  );
}
