"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import {
  createDefaultEngineRuntimeRegistry,
  replayActions,
  type BalanceMachineConfig,
  type BalanceMachineState,
  type DragDropConfig,
  type DragDropState,
  type EngineEvaluationResult,
  type EngineSemanticAction,
  type QuickQuestionConfig,
  type QuickQuestionState,
} from "@quest-city-web/learning-engines";
import {
  BALANCE_MACHINE_DEMO_CONFIG,
  DRAG_AND_DROP_DEMO_CONFIG,
  QUICK_QUESTION_DEMO_CONFIG,
} from "../../lib/engine-demo-configs";
import { BalanceMachineView } from "./BalanceMachineView";
import { QuickQuestionView } from "./QuickQuestionView";
import { DragAndDropView } from "./DragAndDropView";

const ENGINE_NAME_KEYS: Record<string, string> = {
  "QC-WEB-ENGINE-BALANCE-MACHINE": "engines.balance.name",
  "QC-WEB-ENGINE-QUICK-QUESTION": "engines.quick.name",
  "QC-WEB-ENGINE-DRAG-DROP": "engines.drag.name",
};

const DEMO_CONFIGS: Record<string, unknown> = {
  "QC-WEB-ENGINE-BALANCE-MACHINE": BALANCE_MACHINE_DEMO_CONFIG,
  "QC-WEB-ENGINE-QUICK-QUESTION": QUICK_QUESTION_DEMO_CONFIG,
  "QC-WEB-ENGINE-DRAG-DROP": DRAG_AND_DROP_DEMO_CONFIG,
};

export interface EngineHostProps {
  runtimeAdapterId: string;
  /**
   * WEB-M4 (07_25 v1.0 §7-E/§16): a real activity config, overriding the
   * demonstration lookup below when present. `EngineHost` itself stays
   * generic — it never knows whether a config is real M06 content or a
   * demo fixture, only whether one was supplied.
   */
  config?: unknown;
  /**
   * R3C.2: invoked with the real `engine.evaluate()` result right after a
   * confirmed evaluation, in addition to the host's own local result
   * badge. Lets `SequenceHost` apply the current stage's `ProgressionRule`
   * without this component knowing anything about sequences — the
   * orchestrator never reaches into `EngineHost`'s internal state.
   */
  onEvaluated?: (result: EngineEvaluationResult) => void;
  /**
   * WEB-M4: invoked with every locally-accepted semantic action, in
   * addition to the client-side simulation already driving the UI. Lets a
   * real attempt lifecycle (POST /attempts/{id}/actions) mirror each
   * action without this component knowing anything about attempts — the
   * same "notify, don't own" pattern as `onEvaluated`.
   */
  onAction?: (action: EngineSemanticAction) => void;
  /**
   * M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §13): the current
   * attempt's own already-submitted semantic actions (ordered by
   * `clientSequence`), replayed once at mount to rehydrate `state` instead
   * of a bare `engine.initState()` — resumes a multi-item interaction
   * (e.g. `QUICK_QUESTION_SET`'s `ITEM_SET`) at the correct item after a
   * reload rather than silently resetting to the first one. Omitted or
   * empty behaves exactly like the previous bare `initState()` (`replayActions`
   * over an empty list returns the same state) — WEB-M4/Tranche 1 callers
   * that never pass this prop are unaffected.
   */
  initialActions?: EngineSemanticAction[];
  /**
   * Pilot UX/UI Redesign UI-R3 §15: `EngineHost` was originally a
   * standalone page component (`/w/engine/:id`'s demo sandbox) — its own
   * "back to /w" link and engine-name heading make sense there, but when
   * embedded inside `SequenceHost`/`FullSequenceHost` (the real M06
   * activity shell, which already renders its own back link and stage
   * framing) they showed up as a confusing second "back" link pointing to
   * the dev redirect gate `/w` in the middle of a live attempt. `embedded`
   * suppresses both; the accessibility keyboard hint stays either way.
   * Defaults to `false` so the standalone sandbox route is unaffected.
   */
  embedded?: boolean;
}

/**
 * Minimal Engine Host (R3C.1 §43-44): resolves an engine by
 * `runtimeAdapterId` from the same `EngineRuntimeRegistry` the server uses,
 * dispatches semantic actions through `engine.applyAction`, and shows
 * `engine.evaluate`'s result — client-side against either a demonstration
 * configuration or (WEB-M4) a real activity `config` override. One host,
 * one dispatch path, one result renderer shared by all 3 engines rather
 * than per-engine host logic.
 */
export function EngineHost({ runtimeAdapterId, config, onEvaluated, onAction, initialActions, embedded = false }: EngineHostProps) {
  const registry = useMemo(() => createDefaultEngineRuntimeRegistry(), []);
  const engine = registry.getByRuntimeAdapterId(runtimeAdapterId);
  const resolvedConfig = config ?? DEMO_CONFIGS[runtimeAdapterId];

  if (!engine || resolvedConfig === undefined) {
    return <StatusMessage kind="error">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.engineUnavailable")}</StatusMessage>;
  }

  return (
    <ResolvedEngineHost
      engine={engine}
      demoConfig={resolvedConfig}
      nameKey={ENGINE_NAME_KEYS[runtimeAdapterId] ?? "engines.index.title"}
      embedded={embedded}
      {...(onEvaluated ? { onEvaluated } : {})}
      {...(onAction ? { onAction } : {})}
      {...(initialActions ? { initialActions } : {})}
    />
  );
}

function ResolvedEngineHost({
  engine,
  demoConfig,
  nameKey,
  embedded,
  onEvaluated,
  onAction,
  initialActions,
}: {
  engine: NonNullable<ReturnType<ReturnType<typeof createDefaultEngineRuntimeRegistry>["getByRuntimeAdapterId"]>>;
  demoConfig: unknown;
  nameKey: string;
  embedded: boolean;
  onEvaluated?: (result: EngineEvaluationResult) => void;
  onAction?: (action: EngineSemanticAction) => void;
  initialActions?: EngineSemanticAction[];
}) {
  const configValidation = useMemo(() => engine.validateConfig(demoConfig), [engine, demoConfig]);
  const validConfig = configValidation.valid ? configValidation.config : undefined;

  const [state, setState] = useState(() =>
    validConfig !== undefined ? replayActions(engine, validConfig, initialActions ?? []).state : undefined,
  );
  const [result, setResult] = useState<ReturnType<typeof engine.evaluate> | null>(null);

  if (!validConfig || state === undefined) {
    return (
      <StatusMessage kind="error">
        {configValidation.valid ? "" : configValidation.errors.join("; ")}
      </StatusMessage>
    );
  }

  function dispatch(action: EngineSemanticAction) {
    if (!validConfig) return;
    const outcome = engine!.applyAction(state!, validConfig, action);
    if (outcome.accepted) {
      setState(outcome.state);
      setResult(null);
      onAction?.(action);
    }
  }

  function handleReset() {
    dispatch({ actionType: "RESET_STAGE", targetRole: null, payload: {} });
  }

  // Evaluate immediately after a CONFIRM_SOLUTION is accepted — state was
  // just updated by dispatch(), so re-derive the result from the latest
  // state rather than relying on a second render.
  function confirmAndEvaluate() {
    if (!validConfig) return;
    const confirmAction: EngineSemanticAction = {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    };
    const outcome = engine.applyAction(state, validConfig, confirmAction);
    if (outcome.accepted) {
      setState(outcome.state);
      onAction?.(confirmAction);
      const evalResult = engine.evaluate(outcome.state, validConfig);
      setResult(evalResult);
      // Only a real evaluation is forwarded to the orchestrator (R3C.2
      // §16 boundary: the orchestrator reacts to a completed evaluation,
      // never to engine-internal progress). A multi-item ITEM_SET's
      // CONFIRM_SOLUTION legitimately produces `evaluated: false`
      // ("SET_IN_PROGRESS") for every item but the last — forwarding that
      // unconditionally would let `ON_ENGINE_EVALUATION_ANY` complete the
      // stage after the very first item, since it advances on any
      // orchestrator-received result regardless of `evaluated`.
      if (evalResult.evaluated) {
        onEvaluated?.(evalResult);
      }
    }
  }

  return (
    <div>
      {!embedded && (
        <>
          <p>
            <Link href="/w">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
          </p>
          <h2>{t(STUDENT_WEB_CATALOG_IT_IT, nameKey)}</h2>
        </>
      )}
      <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.keyboardHint")}</StatusMessage>

      {engine.runtimeAdapterId === "QC-WEB-ENGINE-BALANCE-MACHINE" && (
        <BalanceMachineView
          config={validConfig as BalanceMachineConfig}
          state={state as BalanceMachineState}
          onPlace={(tokenId, side) =>
            dispatch({ actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId, side } })
          }
        />
      )}
      {engine.runtimeAdapterId === "QC-WEB-ENGINE-QUICK-QUESTION" && (
        <QuickQuestionView
          config={validConfig as QuickQuestionConfig}
          state={state as QuickQuestionState}
          onSelectOption={(optionId) =>
            dispatch({ actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId } })
          }
          onEnterValue={(value) =>
            dispatch({ actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value } })
          }
        />
      )}
      {engine.runtimeAdapterId === "QC-WEB-ENGINE-DRAG-DROP" && (
        <DragAndDropView
          config={validConfig as DragDropConfig}
          state={state as DragDropState}
          onPlace={(itemId, targetId) =>
            dispatch({ actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId, targetId } })
          }
        />
      )}

      <div className="qc-engine-actions">
        <Button type="button" variant="secondary" onClick={handleReset}>
          {t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resetButton")}
        </Button>
        <Button type="button" onClick={confirmAndEvaluate}>
          {t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.confirmButton")}
        </Button>
      </div>

      {result && (
        <StatusBadge tone={result.evaluated ? (result.correctness === "CORRECT" ? "success" : "warning") : "neutral"}>
          {result.evaluated
            ? result.correctness === "CORRECT"
              ? t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultCorrect")
              : t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultIncorrect")
            : t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultPending")}
          {/* M06 Web Full Vertical Slice Tranche 4 (07_26 v1.0 §5/§13): a
              generic, engine-agnostic rendering of any evidence-declared
              feedback text — the engine decides whether to populate it,
              EngineHost never inspects which engine produced it. */}
          {result.evaluated && typeof result.evidence["feedbackText"] === "string"
            ? `: ${result.evidence["feedbackText"] as string}`
            : ""}
        </StatusBadge>
      )}
    </div>
  );
}
