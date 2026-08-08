import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuickQuestionView } from "./QuickQuestionView";

const OPTION_CONFIG = { mode: "OPTION_SELECTION" as const, options: [{ optionId: "a" }, { optionId: "b" }], correctOptionId: "a" };
const NUMERIC_CONFIG = { mode: "ENTER_VALUE" as const, expectedValue: 5, tolerance: 0 };

describe("QuickQuestionView — OPTION_SELECTION", () => {
  it("renders one native <button> per option with aria-pressed reflecting selection", () => {
    render(
      <QuickQuestionView config={OPTION_CONFIG} state={{ confirmed: false }} onSelectOption={vi.fn()} onEnterValue={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("clicking an option calls onSelectOption with its optionId", () => {
    const onSelectOption = vi.fn();
    render(
      <QuickQuestionView config={OPTION_CONFIG} state={{ confirmed: false }} onSelectOption={onSelectOption} onEnterValue={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onSelectOption).toHaveBeenCalledWith("b");
  });

  it("marks the selected option aria-pressed=true", () => {
    render(
      <QuickQuestionView
        config={OPTION_CONFIG}
        state={{ selectedOptionId: "a", confirmed: false }}
        onSelectOption={vi.fn()}
        onEnterValue={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "a" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("QuickQuestionView — ENTER_VALUE", () => {
  it("renders a native numeric <input>, keyboard-operable by construction", () => {
    render(
      <QuickQuestionView config={NUMERIC_CONFIG} state={{ confirmed: false }} onSelectOption={vi.fn()} onEnterValue={vi.fn()} />,
    );
    const input = screen.getByRole("spinbutton");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("type", "number");
  });

  it("typing a value calls onEnterValue with the numeric value", () => {
    const onEnterValue = vi.fn();
    render(
      <QuickQuestionView config={NUMERIC_CONFIG} state={{ confirmed: false }} onSelectOption={vi.fn()} onEnterValue={onEnterValue} />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    expect(onEnterValue).toHaveBeenCalledWith(5);
  });
});
