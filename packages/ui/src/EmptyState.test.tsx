import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title with role=status for assistive-tech announcement", () => {
    render(<EmptyState title="Nessuno studente iscritto" />);
    expect(screen.getByRole("status")).toHaveTextContent("Nessuno studente iscritto");
  });

  it("renders description and action only when provided", () => {
    const { rerender } = render(<EmptyState title="Vuoto" />);
    expect(screen.queryByText("dettaglio")).not.toBeInTheDocument();

    rerender(<EmptyState title="Vuoto" description="dettaglio" action={<button type="button">Azione</button>} />);
    expect(screen.getByText("dettaglio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Azione" })).toBeInTheDocument();
  });
});
