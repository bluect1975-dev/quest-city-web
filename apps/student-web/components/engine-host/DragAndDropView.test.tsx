import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DragAndDropView } from "./DragAndDropView";

const CONFIG = {
  items: [{ itemId: "i1" }, { itemId: "i2" }],
  targets: [{ targetId: "t1" }, { targetId: "t2" }],
  correctMapping: [{ itemId: "i1", targetId: "t1" }, { itemId: "i2", targetId: "t2" }],
};

describe("DragAndDropView — select-source-then-destination (no native drag required)", () => {
  it("target buttons are disabled until an item is selected (no accidental placement)", () => {
    render(<DragAndDropView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    for (const target of [screen.getByRole("button", { name: "t1" }), screen.getByRole("button", { name: "t2" })]) {
      expect(target).toBeDisabled();
    }
  });

  it("selecting an item then a target calls onPlace(itemId, targetId) — same semantics a pointer drag would produce", () => {
    const onPlace = vi.fn();
    render(<DragAndDropView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={onPlace} />);
    fireEvent.click(screen.getByRole("button", { name: /^i1/ }));
    fireEvent.click(screen.getByRole("button", { name: "t1" }));
    expect(onPlace).toHaveBeenCalledWith("i1", "t1");
  });

  it("target buttons become enabled once an item is selected", () => {
    render(<DragAndDropView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^i1/ }));
    expect(screen.getByRole("button", { name: "t1" })).toBeEnabled();
  });

  it("all interactive controls are native <button> elements", () => {
    render(<DragAndDropView config={CONFIG} state={{ placements: {}, confirmed: false }} onPlace={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
    }
  });
});
