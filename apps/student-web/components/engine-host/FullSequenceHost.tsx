"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, ProgressBar, ProgressSteps, StatusBadge, StatusMessage, type ProgressStepState } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { createDefaultEngineRuntimeRegistry, type EngineEvaluationResult, type EngineSemanticAction } from "@quest-city-web/learning-engines";
import {
  addAttemptReference,
  advanceStage,
  initializeSequence,
  isSequenceComplete,
  receiveEngineResult,
  requestHint,
  resolveCurrentStage,
  resolveEngineDispatch,
  resolveWebTranche6StageGroup,
  type SequenceRuntimeState,
  WEB_M4_ACTIVITY_STAGE_ID,
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
  WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
  WEB_TRANCHE5_INTRO_HOOK_CONTENT,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
  WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION,
  WEB_TRANCHE6_FULL_SEQUENCE_ID,
  WEB_TRANCHE6_REFLECTION_STAGE_ID,
} from "@quest-city-web/content-runtime";
import { EngineHost } from "./EngineHost";
import { ScenePresentation } from "../scene/ScenePresentation";
import { stageTypeLabel } from "../../lib/stage-type-label";
import {
  createSequenceRuntimeState,
  loadSequenceRuntimeState,
  saveSequenceRuntimeState,
  SequenceRuntimeStateClientError,
} from "../../lib/sequence-runtime-state-client";
import { useStudentAuth } from "../../lib/student-auth-context";
import {
  completeAttempt,
  getAttemptActions,
  getWebM4Activity,
  getWebTranche1Activity,
  getWebTranche2Activity,
  getWebTranche3Activity,
  getWebTranche4Activity,
  getWebTranche5Activity,
  getWebTranche6Activity,
  launchActivity,
  notifyOrchestrationStageEntry,
  submitAction,
} from "../../lib/student-api-client";
import { StudentApiError } from "../../lib/student-api-error";

/** `07_13` §4 stage->engine-config wiring, merged from the 5 existing tranches' own `ACTIVITY_REGISTRY` entries — no config is redefined here. */
const STAGE_CONFIGS: Record<string, unknown> = {
  [WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID]: WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  [WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID]: WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  [WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID]: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
  [WEB_M4_ACTIVITY_STAGE_ID]: WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
};

const STAGE_PROMPTS: Record<string, { titleKey: string; bodyKey: string }> = {
  ...WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: { titleKey: "guidedPractice.promptTitle", bodyKey: "guidedPractice.promptEquation" },
  [WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID]: { titleKey: "interactiveExercise.promptTitle", bodyKey: "interactiveExercise.promptInstruction" },
  [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: { titleKey: "introHook.promptTitle", bodyKey: "introHook.promptBody" },
};

const STAGE_SCENES: Record<string, string[]> = {
  [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: [...WEB_TRANCHE5_INTRO_HOOK_CONTENT.semanticRoles],
};

/** Only `REFLECTION_AND_RESULT` recaps a prior stage — unlike Tranche 1's own `SequenceHost` usage (a single global prop, safe there because `REFLECTION_AND_RESULT` was the only non-interactive stage), this sequence has many non-interactive stages, so recap must be resolved per-stage. */
const RECAP_BY_STAGE: Record<string, string> = {
  [WEB_TRANCHE6_REFLECTION_STAGE_ID]: WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
};

/**
 * `POST /assignments/{assignmentId}/launch-context` requires the
 * assignment's real database id, never its public_id — the same resolution
 * step `ActivityPage` already performs via the student home page's
 * `getWebTrancheNActivity()`/`getWebM4Activity()` calls. Reused verbatim
 * here, one resolver per group, keyed by that group's `groupStageId`.
 */
const GROUP_ASSIGNMENT_RESOLVERS: Record<string, () => Promise<{ assignmentId: string }>> = {
  [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: getWebTranche5Activity,
  [WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID]: getWebTranche3Activity,
  [WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID]: getWebTranche2Activity,
  [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: getWebTranche1Activity,
  [WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID]: getWebTranche4Activity,
  [WEB_M4_ACTIVITY_STAGE_ID]: getWebM4Activity,
  [WEB_TRANCHE6_REFLECTION_STAGE_ID]: getWebTranche6Activity,
};

interface CurrentGroupAttempt {
  groupStageId: string;
  attemptId: string;
  activityId: string;
  initialActions: EngineSemanticAction[];
}

/** Stable per (student session, group assignment) creation key — mirrors `ActivityPage`'s `getOrCreateLaunchIdempotencyKey`, one independent key per underlying assignment since this page launches up to 7 of them across its lifetime. */
function getOrCreateLaunchIdempotencyKey(assignmentPublicId: string): string {
  const storageKey = `qc_web_full_sequence_launch_idem_${assignmentPublicId}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, fresh);
  return fresh;
}

/** Mirrors `ActivityPage`'s `readNextClientSequence`, keyed per underlying group attempt (not per page/outer sequence). */
function readNextClientSequence(attemptId: string): number {
  const storageKey = `qc_web_full_sequence_client_sequence_${attemptId}`;
  const stored = window.sessionStorage.getItem(storageKey);
  const next = stored ? Number(stored) + 1 : 0;
  window.sessionStorage.setItem(storageKey, String(next));
  return next;
}

function describeError(caught: unknown): string {
  if (caught instanceof StudentApiError) return translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code);
  if (caught instanceof SequenceRuntimeStateClientError && caught.code) {
    return translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code);
  }
  return translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR");
}

/**
 * `/w/full-sequence` (M06 Web Full Vertical Slice Tranche 6, `07_26 v1.1`
 * §17.4): the single unified 8-canonical-stage experience. Drives
 * `WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION` through one durable
 * `SequenceRuntimeState` (R3C.3, keyed by `WEB_TRANCHE6_FULL_SEQUENCE_ID` —
 * no assignment/attempt of its own), while each of the 7 attempt-bearing
 * groups (`resolveWebTranche6StageGroup`) is backed by its own,
 * already-existing `learning_attempt` — launched/resumed lazily via the
 * exact same `launchActivity`/`submitAction`/`completeAttempt` calls
 * `ActivityPage` already makes for a standalone tranche, just issued
 * multiple times against different assignments as the outer orchestration
 * crosses group boundaries. `addAttemptReference` (dormant since R3C.2)
 * records each group's attemptId on the outer state as it resolves.
 */
export default function FullSequenceHost() {
  const { status, csrfToken } = useStudentAuth();

  const runtimeRegistry = useMemo(() => createDefaultEngineRuntimeRegistry(), []);
  const [state, setState] = useState<SequenceRuntimeState | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const [currentAttempt, setCurrentAttempt] = useState<CurrentGroupAttempt | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastClientSequenceRef = useRef<number | null>(null);
  const pendingActionsRef = useRef<Promise<void>[]>([]);
  const notifiedStageEntryRef = useRef<Set<string>>(new Set());
  const launchingGroupRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !csrfToken) return;
    let cancelled = false;
    async function bootstrap() {
      try {
        const loaded = await loadSequenceRuntimeState(WEB_TRANCHE6_FULL_SEQUENCE_ID);
        if (cancelled) return;
        if (loaded.found) {
          versionRef.current = loaded.version;
          setState(loaded.state);
          return;
        }
        const fresh = initializeSequence(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, crypto.randomUUID());
        const created = await createSequenceRuntimeState(WEB_TRANCHE6_FULL_SEQUENCE_ID, fresh, csrfToken as string);
        if (cancelled) return;
        versionRef.current = created.version;
        setState(created.state);
      } catch (caught) {
        if (!cancelled) setError(describeError(caught));
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [status, csrfToken]);

  async function persist(nextState: SequenceRuntimeState) {
    if (versionRef.current === undefined || !csrfToken) return;
    try {
      const saved = await saveSequenceRuntimeState(WEB_TRANCHE6_FULL_SEQUENCE_ID, nextState, versionRef.current, csrfToken);
      versionRef.current = saved.version;
    } catch (caught) {
      if (caught instanceof SequenceRuntimeStateClientError && caught.code === "SEQUENCE_RUNTIME_STATE_VERSION_CONFLICT") {
        try {
          const reloaded = await loadSequenceRuntimeState(WEB_TRANCHE6_FULL_SEQUENCE_ID);
          if (reloaded.found) {
            versionRef.current = reloaded.version;
            setState(reloaded.state);
          }
        } catch {
          // Leave local state as-is; the next successful persist re-syncs.
        }
      }
    }
  }

  // Resolves (launching if necessary) the attempt backing the current stage's group.
  useEffect(() => {
    if (!state || !csrfToken || isSequenceComplete(state)) return;
    const currentStage = resolveCurrentStage(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state);
    const group = resolveWebTranche6StageGroup(currentStage.stageId);
    if (currentAttempt?.groupStageId === group.groupStageId) return;
    if (launchingGroupRef.current === group.groupStageId) return;
    launchingGroupRef.current = group.groupStageId;
    let cancelled = false;

    async function resolveGroup() {
      setGroupLoading(true);
      try {
        const existingRef = state!.attemptReferences.find((r) => r.stageId === group.groupStageId);
        let attemptId: string;
        if (existingRef) {
          attemptId = existingRef.attemptId;
        } else {
          const resolver = GROUP_ASSIGNMENT_RESOLVERS[group.groupStageId];
          if (!resolver) throw new Error(`No assignment resolver registered for group "${group.groupStageId}"`);
          const { assignmentId } = await resolver();
          const idempotencyKey = getOrCreateLaunchIdempotencyKey(assignmentId);
          const launch = await launchActivity(assignmentId, csrfToken as string, idempotencyKey);
          attemptId = launch.attempt.attemptId;
          const withRef = addAttemptReference(state!, group.groupStageId, attemptId);
          if (cancelled) return;
          setState(withRef);
          void persist(withRef);
        }
        const priorActions = await getAttemptActions(attemptId);
        if (cancelled) return;
        lastClientSequenceRef.current = null;
        pendingActionsRef.current = [];
        setCurrentAttempt({
          groupStageId: group.groupStageId,
          attemptId,
          activityId: group.activityId,
          initialActions: priorActions.map((action) => ({ ...action })) as EngineSemanticAction[],
        });
      } catch (caught) {
        if (!cancelled) setError(describeError(caught));
      } finally {
        if (!cancelled) setGroupLoading(false);
        launchingGroupRef.current = null;
      }
    }
    void resolveGroup();
    return () => {
      cancelled = true;
    };
    // Deliberately depends on `state?.currentStageId` (a stable primitive), not `state` itself: this
    // effect's own `setState(withRef)` call (recording the newly-launched attempt reference) would
    // otherwise re-trigger this same effect while `resolveGroup` is still in flight, tearing down the
    // in-flight closure (`cancelled = true`) before it ever reaches `setCurrentAttempt`/`setGroupLoading(false)`
    // — a self-cancellation bug caught during the Tranche 6 browser walkthrough, not by any automated test
    // (the integration suite drives the orchestrator/repositories directly, never this React effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentStageId, csrfToken, currentAttempt]);

  // Non-interactive orchestration-stage-entry trigger (07_15_01 v1.3 §11-bis.2-bis) — mirrors SequenceHost's own effect, scoped to the current group's attempt.
  useEffect(() => {
    if (!state || !currentAttempt || !csrfToken || isSequenceComplete(state)) return;
    const currentStage = resolveCurrentStage(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state);
    if (currentStage.isInteractive || currentStage.engineDispatchRef) return;
    if (notifiedStageEntryRef.current.has(currentStage.stageId)) return;
    notifiedStageEntryRef.current.add(currentStage.stageId);
    void notifyOrchestrationStageEntry(currentAttempt.attemptId, csrfToken).catch(() => {
      notifiedStageEntryRef.current.delete(currentStage.stageId);
    });
  }, [state, currentAttempt, csrfToken]);

  async function maybeCompleteOutgoingGroup(nextState: SequenceRuntimeState, outgoing: CurrentGroupAttempt) {
    if (!csrfToken) return;
    const stillSameGroup =
      !isSequenceComplete(nextState) && resolveWebTranche6StageGroup(nextState.currentStageId).groupStageId === outgoing.groupStageId;
    if (stillSameGroup) return;
    try {
      await Promise.all(pendingActionsRef.current);
      await completeAttempt(outgoing.attemptId, lastClientSequenceRef.current ?? undefined, csrfToken);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  function handleEvaluated(result: EngineEvaluationResult) {
    if (!state || !currentAttempt) return;
    const outcome = receiveEngineResult(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state, result);
    const advanced = outcome.outcome === "ADVANCED";
    const nextState = advanced ? advanceStage(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, outcome.state) : outcome.state;
    setState(nextState);
    void persist(nextState);
    if (advanced) void maybeCompleteOutgoingGroup(nextState, currentAttempt);
  }

  function handleAction(action: EngineSemanticAction) {
    if (!currentAttempt || !csrfToken) return;
    const clientSequence = readNextClientSequence(currentAttempt.attemptId);
    lastClientSequenceRef.current = clientSequence;
    const submitted = submitAction(
      {
        actionId: crypto.randomUUID(),
        attemptId: currentAttempt.attemptId,
        activityId: currentAttempt.activityId,
        actionType: action.actionType,
        ...(action.targetRole ? { targetRole: action.targetRole } : {}),
        payload: action.payload,
        clientSequence,
        runtimeChannel: "WEB",
        occurredAt: new Date().toISOString(),
      },
      csrfToken,
    ).catch((caught) => setError(describeError(caught)));
    pendingActionsRef.current.push(submitted);
  }

  function handleContinue() {
    if (!state || !currentAttempt) return;
    const nextState = advanceStage(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state);
    setState(nextState);
    void persist(nextState);
    void maybeCompleteOutgoingGroup(nextState, currentAttempt);
  }

  function handleRequestHint() {
    if (!state) return;
    const nextState = requestHint(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state);
    setState(nextState);
    void persist(nextState);
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

  if (!state) {
    return (
      <main>
        {error && <StatusMessage kind="error">{error}</StatusMessage>}
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.loadingMessage")}</StatusMessage>
      </main>
    );
  }

  if (isSequenceComplete(state)) {
    return (
      <main>
        <p>
          <Link href="/w/home">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
        </p>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "fullSequence.sequenceTitle")}</h2>
        <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.completedMessage")}</StatusBadge>
      </main>
    );
  }

  if (state.sequenceCompletionState === "ABANDONED") {
    return (
      <main>
        <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.abandonedMessage")}</StatusMessage>
      </main>
    );
  }

  const stages = [...WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages].sort((a, b) => a.order - b.order);
  const stage = resolveCurrentStage(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION, state);
  const stageState = state.stageStates.find((s) => s.stageId === stage.stageId);
  const stageIndex = stages.findIndex((s) => s.stageId === stage.stageId);
  const recapStageId = RECAP_BY_STAGE[stage.stageId];

  if (groupLoading || !currentAttempt || currentAttempt.groupStageId !== resolveWebTranche6StageGroup(stage.stageId).groupStageId) {
    return (
      <main>
        {error && <StatusMessage kind="error">{error}</StatusMessage>}
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "fullSequence.launchingGroupMessage")}</StatusMessage>
      </main>
    );
  }

  const dispatch = stage.isInteractive ? resolveEngineDispatch(stage, { runtimeRegistry }) : undefined;
  const isBalanceMachineStage = stage.stageType === "BALANCE_MACHINE_CHALLENGE";

  const progressSteps = stages.map((s) => {
    const order = s.order;
    let stepState: ProgressStepState;
    if (order < stage.order) stepState = "completed";
    else if (order === stage.order) stepState = "current";
    else if (order === stage.order + 1) stepState = "next";
    else stepState = "locked";
    return { id: s.stageId, label: stageTypeLabel(s.stageType), state: stepState };
  });

  return (
    <main>
      <p>
        <Link href="/w/home">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
      </p>
      <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "fullSequence.sequenceTitle")}</h2>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "fullSequence.sequenceDescription")}</p>
      {error && <StatusMessage kind="error">{error}</StatusMessage>}

      <ProgressSteps steps={progressSteps} />
      <ProgressBar
        value={stageIndex}
        max={stages.length}
        label={t(STUDENT_WEB_CATALOG_IT_IT, "sequence.stageProgress", { params: { index: stageIndex + 1, total: stages.length } })}
      />

      <Card className={isBalanceMachineStage ? "qc-hero-card" : undefined}>
        <StatusBadge tone="info">{stageTypeLabel(stage.stageType)}</StatusBadge>

        {STAGE_SCENES[stage.stageId] && <ScenePresentation semanticRoles={STAGE_SCENES[stage.stageId]!} />}

        {!stage.isInteractive && (
          <>
            {STAGE_PROMPTS[stage.stageId] && (
              <div>
                <h3>{t(STUDENT_WEB_CATALOG_IT_IT, STAGE_PROMPTS[stage.stageId]!.titleKey)}</h3>
                <p>{t(STUDENT_WEB_CATALOG_IT_IT, STAGE_PROMPTS[stage.stageId]!.bodyKey)}</p>
              </div>
            )}
          {recapStageId && (
            <div>
              <h3>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.recapTitle")}</h3>
              {(() => {
                const recapState = state.stageStates.find((s) => s.stageId === recapStageId);
                if (!recapState) {
                  return <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.recapNotAttemptedMessage")}</StatusMessage>;
                }
                const recapStageDefinition = WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages.find((s) => s.stageId === recapStageId);
                const maxHintLevel = recapStageDefinition?.hintPolicy?.maxHintLevel ?? recapState.hintLevel;
                return (
                  <>
                    <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.attemptsForStageLabel", { params: { count: recapState.attemptsForStage } })}</p>
                    <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintLevelLabel", { params: { level: recapState.hintLevel, max: maxHintLevel } })}</p>
                    {recapState.checkpointReached && <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.checkpointLabel")}</StatusBadge>}
                  </>
                );
              })()}
            </div>
          )}
          <Button type="button" onClick={handleContinue}>
            {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.nonInteractiveContinueButton")}
          </Button>
        </>
      )}

      {stage.isInteractive && dispatch && !dispatch.resolved && (
        <StatusMessage kind="error">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.unresolvedEngineMessage")}</StatusMessage>
      )}

      {stage.isInteractive && dispatch?.resolved && (
        <>
          {STAGE_PROMPTS[stage.stageId] && (
            <div>
              <h3>{t(STUDENT_WEB_CATALOG_IT_IT, STAGE_PROMPTS[stage.stageId]!.titleKey)}</h3>
              <p>{t(STUDENT_WEB_CATALOG_IT_IT, STAGE_PROMPTS[stage.stageId]!.bodyKey)}</p>
            </div>
          )}
          <EngineHost
            key={currentAttempt.attemptId}
            runtimeAdapterId={dispatch.engine.runtimeAdapterId}
            config={STAGE_CONFIGS[stage.stageId]}
            onEvaluated={handleEvaluated}
            onAction={handleAction}
            initialActions={currentAttempt.initialActions}
            embedded
          />

          {stageState && <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.attemptsForStageLabel", { params: { count: stageState.attemptsForStage } })}</p>}

          {stage.hintPolicy && stageState && (
            <div>
              <Button type="button" variant="secondary" onClick={handleRequestHint} disabled={stageState.hintLevel >= stage.hintPolicy.maxHintLevel}>
                {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintButton")}
              </Button>
              <p>
                {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintLevelLabel", { params: { level: stageState.hintLevel, max: stage.hintPolicy.maxHintLevel } })}
              </p>
              {stageState.hintLevel > 0 &&
                (() => {
                  const currentHint = stage.hintPolicy?.levels?.find((l) => l.level === stageState.hintLevel);
                  if (!currentHint) return null;
                  return <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintContentLabel", { params: { text: currentHint.description } })}</StatusMessage>;
                })()}
              {stageState.hintLevel >= stage.hintPolicy.maxHintLevel && (
                <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintExhaustedLabel")}</StatusMessage>
              )}
            </div>
          )}

          {stageState?.remediationTriggered && <StatusMessage kind="error">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.remediationLabel")}</StatusMessage>}

          {stageState?.checkpointReached && <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.checkpointLabel")}</StatusBadge>}
        </>
      )}
      </Card>
    </main>
  );
}
