"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { createDefaultEngineRuntimeRegistry, type EngineEvaluationResult } from "@quest-city-web/learning-engines";
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

export interface SequenceHostProps {
  definition: SequenceDefinition;
  runtimeStateId: string;
}

/**
 * Minimal Stage/Session sequence UI (R3C.2 §16): wraps the existing,
 * unmodified per-engine `EngineHost` for each interactive stage and drives
 * the orchestrator (`@quest-city-web/content-runtime`) around it — stage
 * navigation, hint level/count, remediation state, checkpoint, and overall
 * progression/completion. Not the final WEB-M4 UI: no persistence wiring
 * (state lives in local `useState`; see `InMemorySequenceRuntimeStateStore`
 * for the persistence-agnostic seam this could be backed by), no attempt
 * creation (that is `packages/attempts`' `recordStageAttempt`, wired at the
 * API layer, out of this client component's scope).
 */
export function SequenceHost({ definition, runtimeStateId }: SequenceHostProps) {
  const runtimeRegistry = useMemo(() => createDefaultEngineRuntimeRegistry(), []);
  const [state, setState] = useState<SequenceRuntimeState>(() => initializeSequence(definition, runtimeStateId));

  const stages = [...definition.stages].sort((a, b) => a.order - b.order);
  const stage = resolveCurrentStage(definition, state);
  const stageState = state.stageStates.find((s) => s.stageId === stage.stageId);
  const stageIndex = stages.findIndex((s) => s.stageId === stage.stageId);

  function handleEvaluated(result: EngineEvaluationResult) {
    const outcome = receiveEngineResult(definition, state, result);
    setState(outcome.state);
    if (outcome.outcome === "ADVANCED") {
      setState(advanceStage(definition, outcome.state));
    }
  }

  function handleContinue() {
    setState(advanceStage(definition, state));
  }

  function handleRequestHint() {
    setState(requestHint(definition, state));
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
      <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.title")}</h2>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.description")}</p>
      <StatusMessage kind="empty">
        {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.stageProgress", { params: { index: stageIndex + 1, total: stages.length } })}
      </StatusMessage>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.stageTypeLabel", { params: { stageType: stage.stageType } })}</p>

      {!stage.isInteractive && (
        <Button type="button" onClick={handleContinue}>
          {t(STUDENT_WEB_CATALOG_IT_IT, "sequence.nonInteractiveContinueButton")}
        </Button>
      )}

      {stage.isInteractive && dispatch && !dispatch.resolved && (
        <StatusMessage kind="error">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.unresolvedEngineMessage")}</StatusMessage>
      )}

      {stage.isInteractive && dispatch?.resolved && (
        <>
          <EngineHost key={stage.stageId} runtimeAdapterId={dispatch.engine.runtimeAdapterId} onEvaluated={handleEvaluated} />

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
