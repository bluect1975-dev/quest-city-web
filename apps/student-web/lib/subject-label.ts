import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

/**
 * Friendly subject label for "Il mio percorso" (Tranche H3). No
 * `subject_catalogue` lookup table exists in this schema (`content_bundle`'s
 * own doc comment) — `path.subjectLabel.*` covers only the codes already
 * known to be real from the M06 canonical corpus (`MAT`, `docs/03-mathematics`).
 * A subject code not yet in that catalog falls back to the raw stored code
 * rather than fabricating a label or throwing — same
 * surface-the-gap-don't-fabricate policy as `stageTypeLabel`, but with a
 * safe fallback instead of a thrown error, since an unrecognized subject
 * code is expected input here (any tenant's own code), not a bug to
 * surface loudly.
 */
export function subjectLabel(subjectId: string): string {
  const key = `path.subjectLabel.${subjectId}`;
  const resolved = t(STUDENT_WEB_CATALOG_IT_IT, key, { onMissingKey: "returnKey" });
  return resolved === key ? subjectId : resolved;
}
