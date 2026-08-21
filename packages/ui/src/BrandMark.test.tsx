import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("renders a decorative svg using currentColor (works on both light and dark shells)", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.innerHTML).toContain("currentColor");
  });
});
