import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressSteps } from "./ProgressSteps";

describe("ProgressSteps", () => {
  it("marks exactly the current step with aria-current=step", () => {
    render(
      <ProgressSteps
        steps={[
          { id: "a", label: "Intro", state: "completed" },
          { id: "b", label: "Domande", state: "current" },
          { id: "c", label: "Bilancia", state: "locked" },
        ]}
      />,
    );
    expect(screen.getByText("Domande").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Intro").closest("li")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Bilancia").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("renders every step's label as visible text, not icon-only", () => {
    render(<ProgressSteps steps={[{ id: "a", label: "Riflessione", state: "next" }]} />);
    expect(screen.getByText("Riflessione")).toBeInTheDocument();
  });
});
