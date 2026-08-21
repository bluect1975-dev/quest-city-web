import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children inside a qc-card section by default", () => {
    render(<Card>Contenuto</Card>);
    const el = screen.getByText("Contenuto");
    expect(el.tagName).toBe("SECTION");
    expect(el).toHaveClass("qc-card");
  });

  it("supports a muted tone and a different element", () => {
    render(
      <Card as="div" tone="muted">
        Muted
      </Card>,
    );
    const el = screen.getByText("Muted");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("qc-card", "qc-card-muted");
  });
});
