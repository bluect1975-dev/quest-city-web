import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

/**
 * Friendly M06 stage-type label (Pilot UX/UI Redesign, UI-R3 §13/§14) —
 * replaces the raw `stage.stageType` enum value that used to be
 * interpolated directly into the page (`"Tipo di stage: INTRO_HOOK"`),
 * visible to real students. `t()`'s own `onMissingKey` behavior (throw
 * outside production, return-key in production) is the deliberate
 * fallback for a stage type not yet in the catalog — this never fabricates
 * a label, it surfaces the gap instead of silently showing nothing.
 */
export function stageTypeLabel(stageType: string): string {
  return t(STUDENT_WEB_CATALOG_IT_IT, `stageTypeLabel.${stageType}`);
}
