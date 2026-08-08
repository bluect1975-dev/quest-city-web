import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the visible text — status is never conveyed by color/tone alone (07_04 §13)", () => {
    render(<StatusBadge tone="success">Pubblicato</StatusBadge>);
    expect(screen.getByText("Pubblicato")).toBeInTheDocument();
  });

  it.each(["neutral", "info", "warning", "danger", "success"] as const)(
    "applies a distinct qc-status-badge-%s class per tone",
    (tone) => {
      const { container } = render(<StatusBadge tone={tone}>x</StatusBadge>);
      expect(container.firstElementChild).toHaveClass("qc-status-badge", `qc-status-badge-${tone}`);
    },
  );
});
