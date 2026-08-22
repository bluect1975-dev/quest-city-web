"use client";

import { Card, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getMyClass } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";

/**
 * `/w/class` — "La mia classe" (Pilot Product Experience Remediation G4,
 * closing the Student Home rebuild mandate §12 and Feature Inventory gap
 * "La mia classe: API_MISSING + UI_MISSING"). Backed by `GET /me/class`
 * (G2) — real class name, real school name, real count of assigned
 * teachers. Deliberately does NOT show teacher names/emails: `staff_account`
 * has no display-name field (see `NEW-GAP-STAFF-DISPLAY-NAME-01`) and
 * showing the login email would violate the mission's own rule against
 * leaking staff/internal identity to students. Anno/indirizzo are
 * deliberately absent too — `school_class` has no such column (schema
 * gap, documented in the Feature Inventory, not invented here).
 */
export default function MyClassPage() {
  const { authStatus, data, error, loading } = useAuthedResource(getMyClass);

  if (authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "class.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "class.title")}</h1>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "class.loading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "class.error")}</StatusMessage>}
      {!loading && !error && data && (
        <Card>
          <dl className="qc-detail-list">
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "class.schoolLabel")}</dt>
              <dd>{data.schoolName}</dd>
            </div>
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "class.classLabel")}</dt>
              <dd>{data.className}</dd>
            </div>
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "class.statusLabel")}</dt>
              <dd>
                {t(
                  STUDENT_WEB_CATALOG_IT_IT,
                  data.enrollmentStatus === "ACTIVE" ? "class.statusActive" : "class.statusSuspended",
                )}
              </dd>
            </div>
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "class.teachersLabel")}</dt>
              <dd>
                {data.assignedTeacherCount === 0 &&
                  t(STUDENT_WEB_CATALOG_IT_IT, "class.teachersCountZero")}
                {data.assignedTeacherCount === 1 &&
                  t(STUDENT_WEB_CATALOG_IT_IT, "class.teachersCountOne")}
                {data.assignedTeacherCount > 1 &&
                  t(STUDENT_WEB_CATALOG_IT_IT, "class.teachersCountMany", {
                    params: { count: String(data.assignedTeacherCount) },
                  })}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </main>
  );
}
