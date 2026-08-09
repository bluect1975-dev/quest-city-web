"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import {
  createDefaultEngineRuntimeRegistry,
  type EngineEvaluationResult,
  type EngineSemanticAction,
} from "@quest-city-web/learning-engines";
import {
  advanceStage,
  initializeSequence,
  isSequenceComplete,
  receiveEngineResult,
  requestHint,
  resolveCurrentStage,
  resolveEngineDispatch,
  type SequenceDefinition,
  type SequenceRuntimeState,
} from "@quest-city-web/content-runtime";
import { EngineHost } from "./EngineHost";
import {
  createSequenceRuntimeState,
  loadSequenceRuntimeState,
  saveSequenceRuntimeState,
  SequenceRuntimeStateClientError,
} from "../../lib/sequence-runtime-state-client";
import { getStoredCsrfToken } from "../../lib/session-client";

export interface SequenceHostProps {
  definition: SequenceDefinition;
  runtimeStateId: string;
  /** WEB-M4: real per-stage engine configs, keyed by `stageId` — overrides the demo config lookup in `EngineHost` when present for the current stage. */
  stageConfigs?: Record<string, unknown>;
  /** WEB-M4: mirrors every locally-accepted semantic action for the current stage's `EngineHost`, e.g. to log it against a real attempt. */
  onAction?: (action: EngineSemanticAction) => void;
  /** M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §13): forwarded verbatim to `EngineHost` so it can rehydrate mid-stage progress (e.g. `QUICK_QUESTION_SET`'s item index) from the current attempt's own action log after a reload. */
  initialActions?: EngineSemanticAction[];
  /** WEB-M4: invoked exactly once, the first time `isSequenceComplete(state)` becomes true — e.g. to submit `POST /attempts/{id}/complete`. */
  onComplete?: () => void;
  /**
   * WEB-M4: overrides the title/description i18n keys, defaulting to the
   * original `"sequence.title"`/`"sequence.description"` (which read
   * "Sequenza dimostrativa, non contenuto curriculare M06 reale" — correct
   * for `/w/sequence`'s demo, but false for a real activity). Real callers
   * must supply their own copy rather than inherit the demo's disclaimer.
   */
  titleKey?: string;
  descriptionKey?: string;
  /** Optional per-stage prompt copy (title + body i18n keys), rendered above the interactive `EngineHost` — e.g. displaying the equation an ENG-QUICK stage asks the student to solve, since neither the engine config nor `EngineHost` itself render freeform activity text. */
  stagePrompts?: Record<string, { titleKey: string; bodyKey: string }>;
  /** When set and the current stage is non-interactive, renders a recap of the named prior stage's runtime stats (hints used, attempts, checkpoint) above the continue button — e.g. a `REFLECTION_AND_RESULT` stage recapping the preceding `GUIDED_PRACTICE` stage. */
  recapStageId?: string;
}

/**
 * Minimal Stage/Session sequence UI (R3C.2 §16, durable wiring added
 * R3C.3 §18): wraps the existing, unmodified per-engine `EngineHost` for
 * each interactive stage and drives the orchestrator
 * (`@quest-city-web/content-runtime`) around it — stage navigation, hint
 * level/count, remediation state, checkpoint, and overall progression/
 * completion. `useState` is still the single render-time source of truth
 * (every mutation goes through it, exactly as before); on mount it loads
 * from `sequence-runtime-state-client` (backed by `sequence_runtime_state`
 * via the API) when a CSRF token is present (`session-client`, i.e. an
 * authenticated session exists), and every subsequent mutation persists
 * the resulting state back — the demo no longer depends exclusively on
 * in-memory state whenever a real session is available. No login UI
 * exists yet in `apps/student-web` (out of scope, §18 "NON costruire
 * ancora WEB-M4 UI finale"): with no stored CSRF token this component
 * falls back to the exact prior pure-`useState`, non-persistent behaviour.
 * Attempt creation remains out of scope (`packages/attempts`'
 * `recordStageAttempt`, wired at the API layer).
 */
export function SequenceHost({
  definition,
  runtimeStateId,
  stageConfigs,
  onAction,
  onComplete,
  titleKey = "sequence.title",
  descriptionKey = "sequence.description",
  stagePrompts,
  recapStageId,
  initialActions,
}: SequenceHostProps) {
  const runtimeRegistry = useMemo(() => createDefaultEngineRuntimeRegistry(), []);
  const [state, setState] = useState<SequenceRuntimeState | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const durableRef = useRef(false);
  const completeNotifiedRef = useRef(false);

  useEffect(() => {
    if (state && isSequenceComplete(state) && !completeNotifiedRef.current) {
      completeNotifiedRef.current = true;
      onComplete?.();
    }
  }, [state, onComplete]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const csrfToken = getStoredCsrfToken();
      if (!csrfToken) {
        if (!cancelled) setState(initializeSequence(definition, runtimeStateId));
        return;
      }
      try {
        const loaded = await loadSequenceRuntimeState(definition.sequenceId);
        if (cancelled) return;
        if (loaded.found) {
          durableRef.current = true;
          versionRef.current = loaded.version;
          setState(loaded.state);
          return;
        }
        const fresh = initializeSequence(definition, crypto.randomUUID());
        const created = await createSequenceRuntimeState(definition.sequenceId, fresh, csrfToken);
        if (cancelled) return;
        durableRef.current = true;
        versionRef.current = created.version;
        setState(created.state);
      } catch {
        // Durable load/create failed (session expired, network, ...) — fall
        // back to in-memory rather than blocking the demo on a persistence error.
        if (!cancelled) setState(initializeSequence(definition, runtimeStateId));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: `definition`/`runtimeStateId` are stable for the lifetime of this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(nextState: SequenceRuntimeState) {
    if (!durableRef.current || versionRef.current === undefined) return;
    const csrfToken = getStoredCsrfToken();
    if (!csrfToken) return;
    try {
      const saved = await saveSequenceRuntimeState(definition.sequenceId, nextState, versionRef.current, csrfToken);
      versionRef.current = saved.version;
    } catch (error) {
      if (error instanceof SequenceRuntimeStateClientError && error.code === "SEQUENCE_RUNTIME_STATE_VERSION_CONFLICT") {
        // Another write landed first (§11 idempotency/concurrency) — adopt
        // the authoritative server state rather than retrying this write blindly.
        try {
          const reloaded = await loadSequenceRuntimeState(definition.sequenceId);
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

  if (state === null) {
    return <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.loadingMessage")}</StatusMessage>;
  }

  const stages = [...definition.stages].sort((a, b) => a.order - b.order);
  const stage = resolveCurrentStage(definition, state);
  const stageState = state.stageStates.find((s) => s.stageId === stage.stageId);
  const stageIndex = stages.findIndex((s) => s.stageId === stage.stageId);

  function handleEvaluated(result: EngineEvaluationResult) {
    const outcome = receiveEngineResult(definition, state!, result);
    const nextState = outcome.outcome === "ADVANCED" ? advanceStage(definition, outcome.state) : outcome.state;
    setState(nextState);
    void persist(nextState);
  }

  function handleContinue() {
    const nextState = advanceStage(definition, state!);
    setState(nextState);
    void persist(nextState);
  }

  function handleRequestHint() {
    const nextState = requestHint(definition, state!);
    setState(nextState);
    void persist(nextState);
  }

  if (isSequenceComplete(state)) {
    return (
      <div>
        <p>
          <Link href="/w">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
        </p>
        <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.completedMessage")}</StatusBadge>
      </div>
    );
  }

  if (state.sequenceCompletionState === "ABANDONED") {
    return <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.abandonedMessage")}</StatusMessage>;
  }

  const dispatchDeps = { runtimeRegistry };
  const dispatch = stage.isInteractive ? resolveEngineDispatch(stage, dispatchDeps) : undefined;

  return (
    <div>
      <p>
        <Link href="/w">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
      </p>
      <h2>{t(STUDENT_WEB_CATALOG_IT_IT, titleKey)}</h2>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, descriptionKey)}</p>
      <StatusMessage kind="empty">
        {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.stageProgress", { params: { index: stageIndex + 1, total: stages.length } })}
      </StatusMessage>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.stageTypeLabel", { params: { stageType: stage.stageType } })}</p>

      {!stage.isInteractive && (
        <>
          {recapStageId && (
            <div>
              <h3>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.recapTitle")}</h3>
              {(() => {
                const recapState = state.stageStates.find((s) => s.stageId === recapStageId);
                if (!recapState) {
                  return <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.recapNotAttemptedMessage")}</StatusMessage>;
                }
                const recapStageDefinition = definition.stages.find((s) => s.stageId === recapStageId);
                const maxHintLevel = recapStageDefinition?.hintPolicy?.maxHintLevel ?? recapState.hintLevel;
                return (
                  <>
                    <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.attemptsForStageLabel", { params: { count: recapState.attemptsForStage } })}</p>
                    <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintLevelLabel", { params: { level: recapState.hintLevel, max: maxHintLevel } })}</p>
                    {recapState.checkpointReached && (
                      <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.checkpointLabel")}</StatusBadge>
                    )}
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
          {stagePrompts?.[stage.stageId] && (
            <div>
              <h3>{t(STUDENT_WEB_CATALOG_IT_IT, stagePrompts[stage.stageId]!.titleKey)}</h3>
              <p>{t(STUDENT_WEB_CATALOG_IT_IT, stagePrompts[stage.stageId]!.bodyKey)}</p>
            </div>
          )}
          <EngineHost
            key={stage.stageId}
            runtimeAdapterId={dispatch.engine.runtimeAdapterId}
            config={stageConfigs?.[stage.stageId]}
            onEvaluated={handleEvaluated}
            {...(onAction ? { onAction } : {})}
            {...(initialActions ? { initialActions } : {})}
          />

          {stageState && (
            <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.attemptsForStageLabel", { params: { count: stageState.attemptsForStage } })}</p>
          )}

          {stage.hintPolicy && stageState && (
            <div>
              <Button type="button" variant="secondary" onClick={handleRequestHint} disabled={stageState.hintLevel >= stage.hintPolicy.maxHintLevel}>
                {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintButton")}
              </Button>
              <p>
                {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintLevelLabel", {
                  params: { level: stageState.hintLevel, max: stage.hintPolicy.maxHintLevel },
                })}
              </p>
              {stageState.hintLevel > 0 &&
                (() => {
                  const currentHint = stage.hintPolicy?.levels?.find((l) => l.level === stageState.hintLevel);
                  if (!currentHint) return null;
                  return (
                    <StatusMessage kind="empty">
                      {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintContentLabel", { params: { text: currentHint.description } })}
                    </StatusMessage>
                  );
                })()}
              {stageState.hintLevel >= stage.hintPolicy.maxHintLevel && (
                <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.hintExhaustedLabel")}</StatusMessage>
              )}
            </div>
          )}

          {stageState?.remediationTriggered && (
            <StatusMessage kind="error">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.remediationLabel")}</StatusMessage>
          )}

          {stageState?.checkpointReached && (
            <StatusBadge tone="success">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.checkpointLabel")}</StatusBadge>
          )}
        </>
      )}
    </div>
  );
}
