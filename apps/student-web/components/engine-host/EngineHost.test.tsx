import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { EngineSemanticAction } from "@quest-city-web/learning-engines";
import { EngineHost } from "./EngineHost";
import {
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_M4_BALANCE_MACHINE_SOLUTION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
} from "@quest-city-web/content-runtime";

/**
 * WEB-M4 (07_25 v1.0 §7-E): `config` override lets `EngineHost` run
 * against real content instead of the demo lookup, and `onAction` mirrors
 * every locally-accepted semantic action — the two hooks a real attempt
 * lifecycle needs without EngineHost knowing anything about attempts.
 */
describe("EngineHost — WEB-M4 config override + onAction", () => {
  it("uses the supplied config instead of the demo config when provided", () => {
    render(<EngineHost runtimeAdapterId="QC-WEB-ENGINE-BALANCE-MACHINE" config={WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG} />);
    // The real WEB-M4 tokens (term-3x/constant-11/constant-4) render as
    // weight labels distinct from the demo config's (3/2/5) — proves the
    // override, not the demo lookup, is what's actually mounted.
    expect(screen.getByText("Peso 15")).toBeInTheDocument();
    expect(screen.getByText("Peso 11")).toBeInTheDocument();
    expect(screen.getByText("Peso 4")).toBeInTheDocument();
  });

  it("calls onAction for every locally-accepted semantic action, including CONFIRM_SOLUTION", () => {
    const onAction = vi.fn();
    const onEvaluated = vi.fn();
    render(
      <EngineHost
        runtimeAdapterId="QC-WEB-ENGINE-BALANCE-MACHINE"
        config={WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG}
        onAction={onAction}
        onEvaluated={onEvaluated}
      />,
    );

    for (const [tokenId, side] of Object.entries(WEB_M4_BALANCE_MACHINE_SOLUTION)) {
      const buttonName = side === "left" ? "Posiziona a sinistra" : "Posiziona a destra";
      const weightLabel = { "term-3x": "Peso 15", "constant-11": "Peso 11", "constant-4": "Peso 4" }[tokenId]!;
      const row = (screen.getByText(weightLabel).closest("li") ?? screen.getByText(weightLabel).parentElement!) as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: buttonName }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    expect(onAction).toHaveBeenCalledTimes(4); // 3 PLACE_ITEM + 1 CONFIRM_SOLUTION
    expect(onAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button" }),
    );
    // Real, deterministic correctness: the WEB-M4 solution constants (15 =
    // 11 + 4, 03_14 §12 VS-A) actually balance through the real engine.
    expect(onEvaluated).toHaveBeenCalledWith(expect.objectContaining({ evaluated: true, correctness: "CORRECT" }));
  });
});

/**
 * M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §13): `initialActions`
 * rehydrates `state` via `replayActions()` at mount instead of a bare
 * `initState()` — proves a reload mid-`QUICK_QUESTION_SET` resumes at the
 * correct item instead of silently resetting to the first one.
 */
describe("EngineHost — initialActions resume (Tranche 2, QUICK_QUESTION_SET)", () => {
  it("with no initialActions, mounts fresh at the first item (unchanged default behaviour)", () => {
    render(<EngineHost runtimeAdapterId="QC-WEB-ENGINE-QUICK-QUESTION" config={WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG} />);
    expect(screen.getByText("Domanda 1 di 6")).toBeInTheDocument();
  });

  it("with prior actions for the first two items, mounts already resumed at the third item — no silent reset", () => {
    const priorActions: EngineSemanticAction[] = [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "B" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "D" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    render(
      <EngineHost
        runtimeAdapterId="QC-WEB-ENGINE-QUICK-QUESTION"
        config={WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG}
        initialActions={priorActions}
      />,
    );
    expect(screen.getByText("Domanda 3 di 6")).toBeInTheDocument();
    expect(screen.queryByText("Domanda 1 di 6")).not.toBeInTheDocument();
  });
});
