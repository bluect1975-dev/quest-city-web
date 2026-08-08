"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../../../lib/RequireStaffAuth";
import { useAsync } from "../../../../../../lib/useAsync";
import { getClassStudent, getStudentAttempts, getStudentProgress } from "../../../../../../lib/staff-api-client";
import type { AttemptHistoryEntry, StudentProgressSummary, StudentRosterEntry } from "../../../../../../lib/staff-api-types";

interface StudentDetailData {
  student: StudentRosterEntry;
  progress: StudentProgressSummary;
  attempts: AttemptHistoryEntry[];
}

/** `/app/classes/{classId}/students/{studentProfileId}` (02_35 §6). Progress + attempt history, both read-only. */
export default function StaffStudentDetailPage() {
  const params = useParams<{ classId: string; studentProfileId: string }>();

  return (
    <RequireStaffAuth>
      {() => <StudentDetailView classId={params.classId} studentProfileId={params.studentProfileId} />}
    </RequireStaffAuth>
  );
}

function StudentDetailView({ classId, studentProfileId }: { classId: string; studentProfileId: string }) {
  const result = useAsync<StudentDetailData>(async () => {
    const [student, progress, attempts] = await Promise.all([
      getClassStudent(classId, studentProfileId),
      getStudentProgress(classId, studentProfileId),
      getStudentAttempts(classId, studentProfileId),
    ]);
    return { student, progress, attempts };
  }, [classId, studentProfileId]);

  return (
    <main>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <h1>{result.data.student.accessAlias}</h1>

          <section>
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.progressTitle")}</h2>
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.totalAttemptsLabel")}: {result.data.progress.aggregate.totalAttempts}
            </p>
          </section>

          <section>
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.attemptsTitle")}</h2>
            {result.data.attempts.length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.emptyAttempts")} />
            ) : (
              <Table
                columns={[
                  {
                    key: "state",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.columnAttemptState"),
                    render: (row) => row.attemptState,
                  },
                  {
                    key: "completion",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.columnCompletionStatus"),
                    render: (row) => row.completionStatus ?? "—",
                  },
                  {
                    key: "channel",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.columnRuntimeChannel"),
                    render: (row) => row.runtimeChannel,
                  },
                  {
                    key: "started",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.columnStartedAt"),
                    render: (row) => new Date(row.startedAt).toLocaleString("it-IT"),
                  },
                  {
                    key: "review",
                    header: "",
                    render: (row) => (
                      <Link href={`/app/attempts/${encodeURIComponent(row.attemptId)}/review`}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.studentDetail.openReview")}
                      </Link>
                    ),
                  },
                ]}
                rows={result.data.attempts}
                rowKey={(row) => row.attemptId}
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
