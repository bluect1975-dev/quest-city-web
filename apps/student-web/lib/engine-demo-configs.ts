import type { BalanceMachineConfig, DragDropConfig, QuickQuestionConfig } from "@quest-city-web/learning-engines";

/**
 * Demonstration-only engine configurations for the Engine Host (`/w/engine`,
 * R3C.1 §43-44). NOT real M06 curriculum content — content materialization
 * is explicitly out of scope for this phase (§38, §75). These exist solely
 * so the 3 P0 engines can be exercised end to end in the browser.
 */
export const BALANCE_MACHINE_DEMO_CONFIG: BalanceMachineConfig = {
  tokens: [
    { tokenId: "token-a", weight: 3 },
    { tokenId: "token-b", weight: 2 },
    { tokenId: "token-c", weight: 5 },
  ],
};

export const QUICK_QUESTION_DEMO_CONFIG: QuickQuestionConfig = {
  mode: "OPTION_SELECTION",
  options: [{ optionId: "option-1" }, { optionId: "option-2" }, { optionId: "option-3" }],
  correctOptionId: "option-2",
};

export const DRAG_AND_DROP_DEMO_CONFIG: DragDropConfig = {
  items: [{ itemId: "item-1" }, { itemId: "item-2" }, { itemId: "item-3" }],
  targets: [{ targetId: "target-a" }, { targetId: "target-b" }, { targetId: "target-c" }],
  correctMapping: [
    { itemId: "item-1", targetId: "target-a" },
    { itemId: "item-2", targetId: "target-b" },
    { itemId: "item-3", targetId: "target-c" },
  ],
};
