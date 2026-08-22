import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BalanceMachineView } from "./BalanceMachineView";

const CONFIG = { tokens: [{ tokenId: "a", weight: 3 }, { tokenId: "b", weight: 2 }] };

/**
 * Accessibility gate (R3C.1 §58, ACCESSIBILITY_MANUAL_FOLLOWUP for anything
 * not covered here): every placement control is a real, native <button> —
 * keyboard-operable (Tab + Enter/Space) and screen-reader-operable by
 * construction, not a div/span with a click handler bolted on.
 */
describe("BalanceMachineView", () => {
  it("renders one left/right button pair per token, all native <button> elements", () => {
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
    }
  });

  it("clicking 'Posiziona a sinistra' for the first token calls onPlace(tokenId, 'left')", () => {
    const onPlace = vi.fn();
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={onPlace} />);
    const leftButtons = screen.getAllByRole("button", { name: "Posiziona a sinistra" });
    fireEvent.click(leftButtons[0]!);
    expect(onPlace).toHaveBeenCalledWith("a", "left");
  });

  it("clicking 'Posiziona a destra' for the second token calls onPlace(tokenId, 'right')", () => {
    const onPlace = vi.fn();
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={onPlace} />);
    const rightButtons = screen.getAllByRole("button", { name: "Posiziona a destra" });
    fireEvent.click(rightButtons[1]!);
    expect(onPlace).toHaveBeenCalledWith("b", "right");
  });

  it("a placed token is shown under its side with its weight", () => {
    render(
      <BalanceMachineView
        config={CONFIG}
        state={{ placements: { a: "left" }, confirmed: false }}
        onPlace={vi.fn()}
      />,
    );
    // "Peso 3" appears twice by design: once in the left-side summary list,
    // once as the persistent row label in the token-placement fieldset.
    expect(screen.getAllByText("Peso 3")).toHaveLength(2);
  });

  it("buttons are keyboard-reachable via Tab order (no tabIndex=-1 traps)", () => {
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });
});

/**
 * Balance Machine visual illustration (Pilot Product Experience
 * Remediation Tranche G6, `UX-BALANCE-VISUAL-01`) — real SVG scale that
 * reacts to which side is heavier, purely decorative (never the sole
 * carrier of state — see the button/text assertions above, unchanged).
 */
describe("BalanceMachineView illustration", () => {
  it("renders a decorative SVG scale that does not add to the accessible button count", () => {
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    const svg = document.querySelector(".qc-balance-svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("tilts right (positive rotation) when the right side is heavier", () => {
    render(
      <BalanceMachineView
        config={CONFIG}
        state={{ placements: { a: "right" }, confirmed: false }}
        onPlace={vi.fn()}
      />,
    );
    const beamGroup = document.querySelector(".qc-balance-beam-group") as HTMLElement;
    expect(beamGroup.style.transform).toBe("rotate(18deg)");
  });

  it("tilts left (negative rotation) when the left side is heavier", () => {
    render(
      <BalanceMachineView
        config={CONFIG}
        state={{ placements: { b: "left" }, confirmed: false }}
        onPlace={vi.fn()}
      />,
    );
    const beamGroup = document.querySelector(".qc-balance-beam-group") as HTMLElement;
    expect(beamGroup.style.transform).toBe("rotate(-18deg)");
  });

  it("stays level (0deg) when both sides are empty or equal", () => {
    render(<BalanceMachineView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    const beamGroup = document.querySelector(".qc-balance-beam-group") as HTMLElement;
    expect(beamGroup.style.transform).toBe("rotate(0deg)");
  });
});
