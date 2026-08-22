"use client";

import { Card, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../lib/student-auth-context";
import { getMyClass } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";

/**
 * `/w/profile` — "Profilo" (Pilot Product Experience Remediation G4,
 * §14). Fields shown are exactly the ones `07_02` §14 lists that this
 * mission's backend actually supports today: alias, school, class,
 * enrollment status. Deliberately omits: PIN (explicitly forbidden by
 * §14), percorso/competenze/rewards/history (no student-facing endpoint
 * exists for any of those — see Feature Inventory, not fabricated here),
 * accessibility settings (no such setting exists in this codebase yet).
 */
export default function ProfilePage() {
  const { status, context } = useStudentAuth();
  const { data, error, loading } = useAuthedResource(getMyClass);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "profile.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "profile.title")}</h1>
      <Card>
        <dl className="qc-detail-list">
          <div>
            <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "profile.aliasLabel")}</dt>
            <dd>{context?.displayAlias ?? ""}</dd>
          </div>
        </dl>
      </Card>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "profile.loading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "profile.error")}</StatusMessage>}
      {!loading && !error && data && (
        <Card>
          <dl className="qc-detail-list">
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "profile.schoolLabel")}</dt>
              <dd>{data.schoolName}</dd>
            </div>
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "profile.classLabel")}</dt>
              <dd>{data.className}</dd>
            </div>
            <div>
              <dt>{t(STUDENT_WEB_CATALOG_IT_IT, "profile.statusLabel")}</dt>
              <dd>
                {t(
                  STUDENT_WEB_CATALOG_IT_IT,
                  data.enrollmentStatus === "ACTIVE" ? "profile.statusActive" : "profile.statusSuspended",
                )}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </main>
  );
}
