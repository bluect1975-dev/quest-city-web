import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { StatusBadgeTone } from "@quest-city-web/ui";

/**
 * Friendly attempt-state label (Pilot UX/UI Redesign, UI-R3 §13/§22) —
 * replaces the raw `attempt.attemptState` enum value that used to be
 * interpolated directly into `/w/result/:attemptId`
 * (`"Stato del tentativo: CONSOLIDATED"`... actually `attemptState` never
 * carries CONSOLIDATED, see learning-attempt-repository.ts's real
 * AttemptState union — the point stands regardless: a raw enum value is
 * never shown to a student).
 */
export function attemptStateLabel(attemptState: string): string {
  return t(STUDENT_WEB_CATALOG_IT_IT, `attemptStateLabel.${attemptState}`);
}

export const ATTEMPT_STATE_TONE: Record<string, StatusBadgeTone> = {
  CREATED: "neutral",
  IN_PROGRESS: "info",
  COMPLETION_SUBMITTED: "info",
  COMPLETED: "success",
  ABANDONED: "warning",
  EXPIRED: "warning",
};
