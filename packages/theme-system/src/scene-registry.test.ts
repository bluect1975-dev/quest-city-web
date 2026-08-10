import { describe, expect, it } from "vitest";
import { QC_SCENE_CORE_PANEL, SCENE_TEMPLATE_REGISTRY, resolveSceneTemplate } from "./scene-registry";

describe("scene template registry (07_12 v1.1 §4/§7, 07_26 v1.1 §13)", () => {
  it("registers exactly the 6 canonical scene templates from 07_12 §7", () => {
    const ids = SCENE_TEMPLATE_REGISTRY.map((s) => s.sceneId);
    expect(ids).toEqual([
      "QC-SCENE-MISSION-PLAZA",
      "QC-SCENE-LESSON-ROOM",
      "QC-SCENE-PRACTICE-ROOM",
      "QC-SCENE-CHALLENGE-ROOM",
      "QC-SCENE-RESULT",
      "QC-SCENE-CORE-PANEL",
    ]);
  });

  it("resolves Mission Plaza as STATIC_2D, matching 07_26 v1.0 §8's reconciliation of 07_12's 'SCENE_2D o STATIC_2D'", () => {
    expect(resolveSceneTemplate("QC-SCENE-MISSION-PLAZA").mode).toBe("STATIC_2D");
  });

  it("resolves Lesson Station and Machine Bay as ANIMATED_2D per 07_12 §4", () => {
    expect(resolveSceneTemplate("QC-SCENE-LESSON-ROOM").mode).toBe("ANIMATED_2D");
    expect(resolveSceneTemplate("QC-SCENE-CHALLENGE-ROOM").mode).toBe("ANIMATED_2D");
  });

  it("never throws: an unknown sceneId falls back to QC-SCENE-CORE-PANEL", () => {
    expect(resolveSceneTemplate("QC-SCENE-DOES-NOT-EXIST")).toEqual(QC_SCENE_CORE_PANEL);
  });
});
