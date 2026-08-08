"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../lib/RequireStaffAuth";
import { useAsync } from "../../../../lib/useAsync";
import { getClass, getClassProgress, listClassStudents } from "../../../../lib/staff-api-client";
import type { ClassSummary, ProgressAggregate, StudentRosterEntry } from "../../../../lib/staff-api-types";

interface ClassDetailData {
  schoolClass: ClassSummary;
  roster: StudentRosterEntry[];
  progress: ProgressAggregate;
}

/** `/app/classes/{classId}` (02_35 §5, §6). Roster + class-level progress, both read-only. */
export default function StaffClassDetailPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  return (
    <RequireStaffAuth>
      {() => <ClassDetailView classId={classId} />}
    </RequireStaffAuth>
  );
}

function ClassDetailView({ classId }: { classId: string }) {
  const result = useAsync<ClassDetailData>(async () => {
    const [schoolClass, roster, progress] = await Promise.all([
      getClass(classId),
      listClassStudents(classId),
      getClassProgress(classId),
    ]);
    return { schoolClass, roster, progress };
  }, [classId]);

  return (
    <main>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <h1>{result.data.schoolClass.name}</h1>

          <section>
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.progressTitle")}</h2>
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.totalAttemptsLabel")}: {result.data.progress.totalAttempts}
            </p>
          </section>

          <section>
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.rosterTitle")}</h2>
            {result.data.roster.length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.emptyRoster")} />
            ) : (
              <Table
                columns={[
                  { key: "alias", header: t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.columnAlias"), render: (row) => row.accessAlias },
                  {
                    key: "status",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.columnEnrollmentStatus"),
                    render: (row) => row.enrollmentStatus,
                  },
                  {
                    key: "open",
                    header: "",
                    render: (row) => (
                      <Link href={`/app/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(row.studentProfileId)}`}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.openStudent")}
                      </Link>
                    ),
                  },
                ]}
                rows={result.data.roster}
                rowKey={(row) => row.studentProfileId}
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
