import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionPath } from "./MissionPath";

describe("MissionPath", () => {
  it("marks exactly the current stop with aria-current=step", () => {
    render(
      <MissionPath
        stops={[
          { id: "a", title: "Balance Machine Challenge", state: "completed" },
          { id: "b", title: "Riattiva la Balance Machine", state: "current", eyebrow: "Tappa 2 · sei qui" },
          { id: "c", title: "Sfida finale", state: "locked" },
        ]}
      />,
    );
    expect(screen.getByText("Riattiva la Balance Machine").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Balance Machine Challenge").closest("li")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Sfida finale").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("renders every stop's title as visible text and the eyebrow when supplied (never state conveyed by color alone)", () => {
    render(<MissionPath stops={[{ id: "a", title: "Verifica finale", state: "available", eyebrow: "Disponibile" }]} />);
    expect(screen.getByText("Verifica finale")).toBeInTheDocument();
    expect(screen.getByText("Disponibile")).toBeInTheDocument();
  });

  it("renders the caller-supplied action for a stop (e.g. a Riprendi button)", () => {
    render(<MissionPath stops={[{ id: "a", title: "In corso", state: "current", action: <button type="button">Riprendi</button> }]} />);
    expect(screen.getByRole("button", { name: "Riprendi" })).toBeInTheDocument();
  });
});
