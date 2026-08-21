import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsCard } from "./StatsCard";

describe("StatsCard", () => {
  it("renders the label, value, and optional action", () => {
    render(<StatsCard label="Studenti assegnati" value={3} action={<a href="/x">Vai</a>} />);
    expect(screen.getByText("Studenti assegnati")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai" })).toBeInTheDocument();
  });

  it("renders without an action when none is given", () => {
    render(<StatsCard label="Proposte in attesa" value={0} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
