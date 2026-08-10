/**
 * Scene template registry (M06 Web Full Vertical Slice Tranche 5,
 * `07_26 v1.1` §13/§17.3). Real evidence, not invented: scene IDs and
 * display modes are `07_12 v1.1` §4 (Experience map) and §7 (Scene
 * template minimi) verbatim —
 *
 *   | Nodo          | Modalità        |
 *   | Web Entry     | STATIC_2D       |
 *   | Mission Plaza | SCENE_2D o STATIC_2D |
 *   | Lesson Station| ANIMATED_2D     |
 *   | Practice Alcove | STATIC_2D / ANIMATED_2D |
 *   | Machine Bay   | ANIMATED_2D     |
 *   | Result        | STATIC_2D       |
 *
 * `07_26 v1.0` §8 already reconciled `07_12`'s "SCENE_2D o STATIC_2D" for
 * Mission Plaza into the binary `STATIC_2D`/`ANIMATED_2D` axis used
 * throughout the rest of the presentation requirement matrix — reused
 * verbatim here rather than re-deriving it.
 *
 * `07_12` §7 scene template IDs: `QC-SCENE-MISSION-PLAZA`,
 * `QC-SCENE-LESSON-ROOM`, `QC-SCENE-PRACTICE-ROOM`,
 * `QC-SCENE-CHALLENGE-ROOM`, `QC-SCENE-RESULT`, `QC-SCENE-CORE-PANEL`
 * (fallback).
 */
export type SceneDisplayMode = "STATIC_2D" | "ANIMATED_2D";

export interface SceneTemplate {
  sceneId: string;
  /** `07_12` §4 "Ruolo" column, verbatim. */
  role: string;
  mode: SceneDisplayMode;
  /** Semantic visual roles this scene is expected to resolve at runtime (`07_14` §9 naming convention). */
  semanticRoles: string[];
}

export const QC_SCENE_CORE_PANEL: SceneTemplate = {
  sceneId: "QC-SCENE-CORE-PANEL",
  role: "fallback neutro",
  mode: "STATIC_2D",
  semanticRoles: [],
};

/**
 * The 6 canonical scene templates. Only `QC-SCENE-MISSION-PLAZA` has a
 * materialized asset batch as of Tranche 5 (`sprite-cook-batch.ts`) — the
 * other 4 scenes plus the fallback remain resolvable (never blocking,
 * `resolveSemanticRole` always falls back to `QC-THEME-CORE`) but their
 * semantic roles are not yet backed by a published asset, honestly
 * reflecting that materializing them belongs to whichever tranche
 * produces the stage that needs them (`07_26 v1.1` §13).
 */
export const SCENE_TEMPLATE_REGISTRY: SceneTemplate[] = [
  {
    sceneId: "QC-SCENE-MISSION-PLAZA",
    role: "orientamento e navigazione",
    mode: "STATIC_2D",
    semanticRoles: ["scene.mission_plaza.background", "character.mentor.idle"],
  },
  {
    sceneId: "QC-SCENE-LESSON-ROOM",
    role: "micro-lesson interattiva",
    mode: "ANIMATED_2D",
    semanticRoles: ["scene.lesson_room.background"],
  },
  {
    sceneId: "QC-SCENE-PRACTICE-ROOM",
    role: "pratica guidata",
    mode: "STATIC_2D",
    semanticRoles: ["scene.practice_room.background"],
  },
  {
    sceneId: "QC-SCENE-CHALLENGE-ROOM",
    role: "challenge applicativa",
    mode: "ANIMATED_2D",
    semanticRoles: ["scene.challenge_room.background"],
  },
  {
    sceneId: "QC-SCENE-RESULT",
    role: "riepilogo e next action",
    mode: "STATIC_2D",
    semanticRoles: ["scene.result.background"],
  },
  QC_SCENE_CORE_PANEL,
];

/** Never throws: an unknown `sceneId` resolves to the always-available `QC-SCENE-CORE-PANEL` fallback (07_14 §18: "QC-THEME-CORE funzionante senza asset academy"). */
export function resolveSceneTemplate(sceneId: string): SceneTemplate {
  return SCENE_TEMPLATE_REGISTRY.find((s) => s.sceneId === sceneId) ?? QC_SCENE_CORE_PANEL;
}
