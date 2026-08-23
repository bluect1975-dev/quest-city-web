import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressRing } from "./ProgressRing";

describe("ProgressRing", () => {
  it("carries the same information visually and via a real accessible label (never color/shape-only)", () => {
    render(<ProgressRing value={1} max={2} caption="di 2 tappe" label="Percorso di Matematica" />);
    expect(screen.getByRole("img", { name: "1 di 2 tappe" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("di 2 tappe")).toBeInTheDocument();
    expect(screen.getByText("Percorso di Matematica")).toBeInTheDocument();
  });

  it("never divides by zero when max is 0", () => {
    render(<ProgressRing value={0} max={0} caption="di 0 tappe" label="Nessuna attività" />);
    expect(screen.getByRole("img", { name: "0 di 0 tappe" })).toBeInTheDocument();
  });
});
