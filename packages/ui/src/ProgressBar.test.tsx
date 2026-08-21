import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("exposes value/min/max for assistive tech and renders a visible text label", () => {
    render(<ProgressBar value={3} max={8} label="3 di 8 completati" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(screen.getByText("3 di 8 completati")).toBeInTheDocument();
  });

  it("clamps value into [0, max]", () => {
    render(<ProgressBar value={99} max={8} label="oltre il massimo" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
  });
});
