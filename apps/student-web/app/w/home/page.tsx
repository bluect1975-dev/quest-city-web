"use client";

import Link from "next/link";
import { Button, Card, EmptyState, StatsCard, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../lib/student-auth-context";
import { getMyAssignments, getMyClass } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";
import { AssignmentList } from "../../../components/AssignmentList";

/**
 * `/w/home` (Pilot UX/UI Redesign, UI-R2 — Student Home). Replaces the
 * previous milestone-by-milestone layout (a "welcome" heading followed by
 * six near-identical "La tua attività" cards, one hardcoded per M06
 * tranche, plus a developer-only "Motori didattici disponibili" sandbox
 * section) with a real hierarchy: one current-mission hero (the M06 full
 * sequence, `/w/full-sequence` — the actual pilot curriculum path) above
 * the student's own `STAFF_GENERAL` assignments.
 *
 * The six hardcoded per-tranche reads (`getWebM4Activity`..
 * `getWebTranche5Activity`) and the `/w/engine/:id` / `/w/sequence`
 * sandbox links are intentionally NOT rendered here anymore — the
 * previous version of this file already documented them as "for
 * regression/dev", never the pilot-ready path (`getMyAssignments` was).
 * Those routes and their backend endpoints are untouched and still
 * directly covered by their own integration tests
 * (`tests/integration/web-tranche{1..6}-*-flow.test.ts`); only this
 * page's product-facing rendering of them is removed.
 *
 * No fabricated progress number is shown here (principio di evidenza —
 * never display data the app doesn't actually have): a real per-stage
 * progress view exists inside `/w/full-sequence` itself (`FullSequenceHost`,
 * UI-R3), which has the real `SequenceRuntimeState`.
 */
export default function StudentHomePage() {
  const { status, context } = useStudentAuth();
  const { data: myAssignments, error: myAssignmentsError, loading: loadingMyAssignments } = useAuthedResource(getMyAssignments);
  const { data: myClass } = useAuthedResource(getMyClass);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "home.welcomeTitle", { params: { alias: context?.displayAlias ?? "" } })}</h1>
      {status === "authenticated-read-only" && (
        <StatusMessage kind="unauthorized">{t(STUDENT_WEB_CATALOG_IT_IT, "home.readOnlySessionWarning")}</StatusMessage>
      )}

      {myClass && (
        <div className="qc-stats-grid">
          <StatsCard label={t(STUDENT_WEB_CATALOG_IT_IT, "class.schoolLabel")} value={myClass.schoolName} />
          <StatsCard
            label={t(STUDENT_WEB_CATALOG_IT_IT, "class.classLabel")}
            value={myClass.className}
            action={<Link href="/w/class">{t(STUDENT_WEB_CATALOG_IT_IT, "shell.navClass")}</Link>}
          />
        </div>
      )}

      <div className="qc-hero-banner">
        <svg className="qc-hero-banner-skyline" viewBox="0 0 340 140" fill="none" aria-hidden="true">
          <path
            d="M0 140 L0 90 L30 90 L30 60 L60 60 L60 100 L90 100 L90 40 L120 40 L120 80 L150 80 L150 55 L180 55 L180 100 L210 100 L210 70 L240 70 L240 110 L270 110 L270 30 L300 30 L300 95 L340 95 L340 140 Z"
            fill="white"
          />
        </svg>
        <p className="qc-hero-banner-eyebrow">{t(STUDENT_WEB_CATALOG_IT_IT, "home.fullSequenceEyebrow")}</p>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.fullSequenceSectionTitle")}</h2>
        <p>{t(STUDENT_WEB_CATALOG_IT_IT, "home.fullSequenceDescription")}</p>
        <Link href="/w/full-sequence">
          <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startFullSequenceButton")}</Button>
        </Link>
      </div>

      <Card>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsSectionTitle")}</h2>
        {loadingMyAssignments && (
          <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsLoading")}</StatusMessage>
        )}
        {!loadingMyAssignments && myAssignmentsError && (
          <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsError")}</StatusMessage>
        )}
        {!loadingMyAssignments && !myAssignmentsError && myAssignments && myAssignments.length === 0 && (
          <EmptyState
            title={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyTitle")}
            description={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyDescription")}
          />
        )}
        {!loadingMyAssignments && !myAssignmentsError && myAssignments && myAssignments.length > 0 && (
          <AssignmentList assignments={myAssignments} />
        )}
      </Card>
    </main>
  );
}
