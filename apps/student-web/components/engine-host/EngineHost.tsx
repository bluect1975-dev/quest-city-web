"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import {
  createDefaultEngineRuntimeRegistry,
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
   * R3C.2: invoked with the real `engine.evaluate()` result right after a
   * confirmed evaluation, in addition to the host's own local result
   * badge. Lets `SequenceHost` apply the current stage's `ProgressionRule`
   * without this component knowing anything about sequences — the
   * orchestrator never reaches into `EngineHost`'s internal state.
   */
  onEvaluated?: (result: EngineEvaluationResult) => void;
}

/**
 * Minimal Engine Host (R3C.1 §43-44): resolves an engine by
 * `runtimeAdapterId` from the same `EngineRuntimeRegistry` the server uses,
 * dispatches semantic actions through `engine.applyAction`, and shows
 * `engine.evaluate`'s result — entirely client-side against a
 * demonstration configuration (no attempt/API wiring; that is out of scope
 * for this phase, see §43). One host, one dispatch path, one result
 * renderer shared by all 3 engines rather than per-engine host logic.
 */
export function EngineHost({ runtimeAdapterId, onEvaluated }: EngineHostProps) {
  const registry = useMemo(() => createDefaultEngineRuntimeRegistry(), []);
  const engine = registry.getByRuntimeAdapterId(runtimeAdapterId);
  const demoConfig = DEMO_CONFIGS[runtimeAdapterId];

  if (!engine || demoConfig === undefined) {
    return (
      <StatusMessage kind="error">
        {t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.title")}: {runtimeAdapterId}
      </StatusMessage>
    );
  }

  return (
    <ResolvedEngineHost
      engine={engine}
      demoConfig={demoConfig}
      nameKey={ENGINE_NAME_KEYS[runtimeAdapterId] ?? "engines.index.title"}
      {...(onEvaluated ? { onEvaluated } : {})}
    />
  );
}

function ResolvedEngineHost({
  engine,
  demoConfig,
  nameKey,
  onEvaluated,
}: {
  engine: NonNullable<ReturnType<ReturnType<typeof createDefaultEngineRuntimeRegistry>["getByRuntimeAdapterId"]>>;
  demoConfig: unknown;
  nameKey: string;
  onEvaluated?: (result: EngineEvaluationResult) => void;
}) {
  const configValidation = useMemo(() => engine.validateConfig(demoConfig), [engine, demoConfig]);
  const validConfig = configValidation.valid ? configValidation.config : undefined;

  const [state, setState] = useState(() => (validConfig !== undefined ? engine.initState(validConfig) : undefined));
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
    const outcome = engine.applyAction(state, validConfig, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    });
    if (outcome.accepted) {
      setState(outcome.state);
      const evalResult = engine.evaluate(outcome.state, validConfig);
      setResult(evalResult);
      onEvaluated?.(evalResult);
    }
  }

  return (
    <div>
      <p>
        <Link href="/w">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
      </p>
      <h2>{t(STUDENT_WEB_CATALOG_IT_IT, nameKey)}</h2>
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
        </StatusBadge>
      )}
    </div>
  );
}
