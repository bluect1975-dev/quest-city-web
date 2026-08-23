"use client";

import { EmptyState, ProgressSteps, StatusMessage, type ProgressStepState } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getMyPath, type MyPath, type MyPathItem } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";
import { subjectLabel } from "../../../lib/subject-label";

const STEP_STATE: Record<MyPathItem["pathState"], ProgressStepState> = {
  COMPLETED: "completed",
  CURRENT: "current",
  AVAILABLE: "next",
  LOCKED: "locked",
};

/**
 * `/w/path` — "Il mio percorso" (Pilot Product Experience Residual
 * Closure, Tranche H3, closes `NEW-GAP-STUDENT-PATH-VIEW-01`). Backed by
 * `GET /me/path`: each item's state is a real server-side GLPC resolution
 * (`resolveEffectiveForLaunchAttempt`, the same resolver `POST
 * /assignments/{id}/launch-context` already enforces), not merely an
 * attempt-completion label re-labelled — the prior version of this page
 * had zero GLPC involvement (disclosed gap this tranche closes).
 *
 * No subject/module/unit curriculum tree exists in this schema (no table
 * was ever migrated for it — 02_25's conceptual model, migration 0013's
 * own header comment). This page does not fabricate one: it groups by the
 * one real hierarchy level that exists (`content_bundle.subject_id`) and
 * otherwise shows the student's real assignments annotated with a real
 * GLPC-derived state. Deliberately distinct from "Assegnazioni" (`/w/
 * assignments`, mission §27): that page answers "what was I assigned",
 * this one answers "where am I in it" — same underlying assignments,
 * different lens, never presented as two near-identical lists.
 */
export default function MyPathPage() {
  const { authStatus, data, error, loading } = useAuthedResource(getMyPath);

  if (authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "path.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "path.title")}</h1>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "path.description")}</p>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "path.loading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "path.error")}</StatusMessage>}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title={t(STUDENT_WEB_CATALOG_IT_IT, "path.emptyTitle")}
          description={t(STUDENT_WEB_CATALOG_IT_IT, "path.emptyDescription")}
        />
      )}
      {!loading && !error && data && data.items.length > 0 && <PathView data={data} />}
    </main>
  );
}

function PathView({ data }: { data: MyPath }) {
  const groups = groupBySubject(data.items);

  return (
    <>
      <p role="status">
        {t(STUDENT_WEB_CATALOG_IT_IT, "path.progressLabel", {
          params: { completed: String(data.progress.completedCount), total: String(data.progress.totalCount) },
        })}
      </p>
      {groups.map(([subjectId, items]) => (
        <section key={subjectId ?? "unknown"} className="qc-card">
          {subjectId && <h2>{subjectLabel(subjectId)}</h2>}
          <ProgressSteps
            steps={items.map((item) => ({
              id: item.assignmentId,
              state: STEP_STATE[item.pathState],
              label: `${item.title} — ${t(STUDENT_WEB_CATALOG_IT_IT, `path.stateLabel.${item.pathState}`)}`,
            }))}
          />
        </section>
      ))}
    </>
  );
}

/** `Map` iterates in insertion order, so grouping preserves the API's own (due-date-then-creation) ordering — no separate re-sort needed. */
function groupBySubject(items: MyPathItem[]): Array<[string | null, MyPathItem[]]> {
  const bySubject = new Map<string | null, MyPathItem[]>();
  for (const item of items) {
    if (!bySubject.has(item.subjectId)) {
      bySubject.set(item.subjectId, []);
    }
    bySubject.get(item.subjectId)!.push(item);
  }
  return [...bySubject.entries()];
}
