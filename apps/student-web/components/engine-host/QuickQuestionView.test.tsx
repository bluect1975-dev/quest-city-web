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

const ITEM_SET_CONFIG = {
  mode: "ITEM_SET" as const,
  items: [
    {
      itemId: "IT-1",
      mode: "OPTION_SELECTION" as const,
      prompt: "Quale scegli?",
      options: [{ optionId: "a", text: "Prima opzione" }, { optionId: "b", text: "Seconda opzione" }],
      correctOptionId: "b",
    },
    { itemId: "IT-2", mode: "ENTER_VALUE" as const, prompt: "Risolvi: x = 7", expectedValue: 7, tolerance: 0 },
  ],
};

describe("QuickQuestionView — ITEM_SET (Tranche 2, QUICK_QUESTION_SET)", () => {
  it("shows progress (item N of M) and renders the current item's option text", () => {
    render(
      <QuickQuestionView config={ITEM_SET_CONFIG} state={{ confirmed: false, currentItemIndex: 0 }} onSelectOption={vi.fn()} onEnterValue={vi.fn()} />,
    );
    expect(screen.getByText("Domanda 1 di 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prima opzione" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seconda opzione" })).toBeInTheDocument();
  });

  it("renders the second item's numeric input once currentItemIndex advances", () => {
    render(
      <QuickQuestionView
        config={ITEM_SET_CONFIG}
        state={{
          confirmed: false,
          currentItemIndex: 1,
          itemResults: [{ itemId: "IT-1", correctness: "CORRECT", feedbackText: "Corretto." }],
        }}
        onSelectOption={vi.fn()}
        onEnterValue={vi.fn()}
      />,
    );
    expect(screen.getByText("Domanda 2 di 2")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("shows the previous item's feedback text alongside the next question", () => {
    render(
      <QuickQuestionView
        config={ITEM_SET_CONFIG}
        state={{
          confirmed: false,
          currentItemIndex: 1,
          itemResults: [{ itemId: "IT-1", correctness: "INCORRECT", feedbackText: "Hai sbagliato l'operazione.", misconceptionCode: "MAT.MIS.ALG.001" }],
        }}
        onSelectOption={vi.fn()}
        onEnterValue={vi.fn()}
      />,
    );
    expect(screen.getByText(/Hai sbagliato l'operazione\./)).toBeInTheDocument();
  });

  it("selecting an option on the current item calls onSelectOption with its optionId", () => {
    const onSelectOption = vi.fn();
    render(
      <QuickQuestionView config={ITEM_SET_CONFIG} state={{ confirmed: false, currentItemIndex: 0 }} onSelectOption={onSelectOption} onEnterValue={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seconda opzione" }));
    expect(onSelectOption).toHaveBeenCalledWith("b");
  });

  it("shows the completion message once currentItemIndex has passed the last item", () => {
    render(
      <QuickQuestionView
        config={ITEM_SET_CONFIG}
        state={{
          confirmed: true,
          currentItemIndex: 2,
          itemResults: [
            { itemId: "IT-1", correctness: "CORRECT", feedbackText: "Corretto." },
            { itemId: "IT-2", correctness: "CORRECT", feedbackText: "Corretto." },
          ],
        }}
        onSelectOption={vi.fn()}
        onEnterValue={vi.fn()}
      />,
    );
    expect(screen.getByText("Hai risposto a tutte le domande.")).toBeInTheDocument();
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
