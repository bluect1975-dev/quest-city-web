import { describe, expect, it } from "vitest";
import { stageTypeLabel } from "./stage-type-label";

describe("stageTypeLabel", () => {
  it("resolves every real M06 stage type to a friendly Italian label, never the raw enum", () => {
    expect(stageTypeLabel("INTRO_HOOK")).toBe("Introduzione");
    expect(stageTypeLabel("PREREQUISITE_CHECK")).toBe("Verifica");
    expect(stageTypeLabel("MICRO_LESSON")).toBe("Lezione");
    expect(stageTypeLabel("QUICK_QUESTION_SET")).toBe("Domande rapide");
    expect(stageTypeLabel("GUIDED_PRACTICE")).toBe("Pratica guidata");
    expect(stageTypeLabel("INTERACTIVE_EXERCISE")).toBe("Esercizio");
    expect(stageTypeLabel("BALANCE_MACHINE_CHALLENGE")).toBe("Bilancia");
    expect(stageTypeLabel("REFLECTION_AND_RESULT")).toBe("Riepilogo");
  });
});
