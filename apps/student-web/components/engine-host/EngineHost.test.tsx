import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EngineHost } from "./EngineHost";
import { WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG, WEB_M4_BALANCE_MACHINE_SOLUTION } from "@quest-city-web/content-runtime";

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
