"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../lib/student-auth-context";
import {
  getWebM4Activity,
  getWebTranche1Activity,
  getWebTranche2Activity,
  getWebTranche3Activity,
  getWebTranche4Activity,
  type WebM4Activity,
} from "../../../lib/student-api-client";
import { StudentApiError } from "../../../lib/student-api-error";

const P0_ENGINES = [
  { runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE", nameKey: "engines.balance.name" },
  { runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION", nameKey: "engines.quick.name" },
  { runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP", nameKey: "engines.drag.name" },
] as const;

/**
 * `/w/home` (WEB-M4, 07_25 v1.0 §7-B, authorization §6): minimal student
 * home — session validity, the one real WEB-M4 learning experience, and an
 * entry point into it. Not the full curriculum browser (§8, out of scope).
 */
export default function StudentHomePage() {
  const { status, context, logout } = useStudentAuth();
  const router = useRouter();
  const [activity, setActivity] = useState<WebM4Activity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [tranche1Activity, setTranche1Activity] = useState<WebM4Activity | null>(null);
  const [tranche1ActivityError, setTranche1ActivityError] = useState<string | null>(null);
  const [loadingTranche1Activity, setLoadingTranche1Activity] = useState(true);
  const [tranche2Activity, setTranche2Activity] = useState<WebM4Activity | null>(null);
  const [tranche2ActivityError, setTranche2ActivityError] = useState<string | null>(null);
  const [loadingTranche2Activity, setLoadingTranche2Activity] = useState(true);
  const [tranche3Activity, setTranche3Activity] = useState<WebM4Activity | null>(null);
  const [tranche3ActivityError, setTranche3ActivityError] = useState<string | null>(null);
  const [loadingTranche3Activity, setLoadingTranche3Activity] = useState(true);
  const [tranche4Activity, setTranche4Activity] = useState<WebM4Activity | null>(null);
  const [tranche4ActivityError, setTranche4ActivityError] = useState<string | null>(null);
  const [loadingTranche4Activity, setLoadingTranche4Activity] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/w/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getWebM4Activity()
      .then((result) => {
        if (!cancelled) setActivity(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setActivityError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingActivity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getWebTranche1Activity()
      .then((result) => {
        if (!cancelled) setTranche1Activity(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setTranche1ActivityError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTranche1Activity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getWebTranche2Activity()
      .then((result) => {
        if (!cancelled) setTranche2Activity(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setTranche2ActivityError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTranche2Activity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getWebTranche3Activity()
      .then((result) => {
        if (!cancelled) setTranche3Activity(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setTranche3ActivityError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTranche3Activity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getWebTranche4Activity()
      .then((result) => {
        if (!cancelled) setTranche4Activity(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setTranche4ActivityError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTranche4Activity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleLogout() {
    await logout();
    router.replace("/w/login");
  }

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

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.activitySectionTitle")}</h2>
        {loadingActivity && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.activityLoading")}</StatusMessage>}
        {!loadingActivity && activityError && <StatusMessage kind="empty">{activityError}</StatusMessage>}
        {!loadingActivity && !activityError && activity && (
          <>
            <p>{activity.title}</p>
            <Link href={`/w/activity/${encodeURIComponent(activity.assignmentId)}`}>
              <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startActivityButton")}</Button>
            </Link>
          </>
        )}
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.activitySectionTitle")}</h2>
        {loadingTranche1Activity && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.activityLoading")}</StatusMessage>}
        {!loadingTranche1Activity && tranche1ActivityError && <StatusMessage kind="empty">{tranche1ActivityError}</StatusMessage>}
        {!loadingTranche1Activity && !tranche1ActivityError && tranche1Activity && (
          <>
            <p>{tranche1Activity.title}</p>
            <Link href={`/w/activity/${encodeURIComponent(tranche1Activity.assignmentId)}`}>
              <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startActivityButton")}</Button>
            </Link>
          </>
        )}
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.activitySectionTitle")}</h2>
        {loadingTranche2Activity && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.activityLoading")}</StatusMessage>}
        {!loadingTranche2Activity && tranche2ActivityError && <StatusMessage kind="empty">{tranche2ActivityError}</StatusMessage>}
        {!loadingTranche2Activity && !tranche2ActivityError && tranche2Activity && (
          <>
            <p>{tranche2Activity.title}</p>
            <Link href={`/w/activity/${encodeURIComponent(tranche2Activity.assignmentId)}`}>
              <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startActivityButton")}</Button>
            </Link>
          </>
        )}
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.activitySectionTitle")}</h2>
        {loadingTranche3Activity && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.activityLoading")}</StatusMessage>}
        {!loadingTranche3Activity && tranche3ActivityError && <StatusMessage kind="empty">{tranche3ActivityError}</StatusMessage>}
        {!loadingTranche3Activity && !tranche3ActivityError && tranche3Activity && (
          <>
            <p>{tranche3Activity.title}</p>
            <Link href={`/w/activity/${encodeURIComponent(tranche3Activity.assignmentId)}`}>
              <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startActivityButton")}</Button>
            </Link>
          </>
        )}
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.activitySectionTitle")}</h2>
        {loadingTranche4Activity && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.activityLoading")}</StatusMessage>}
        {!loadingTranche4Activity && tranche4ActivityError && <StatusMessage kind="empty">{tranche4ActivityError}</StatusMessage>}
        {!loadingTranche4Activity && !tranche4ActivityError && tranche4Activity && (
          <>
            <p>{tranche4Activity.title}</p>
            <Link href={`/w/activity/${encodeURIComponent(tranche4Activity.assignmentId)}`}>
              <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startActivityButton")}</Button>
            </Link>
          </>
        )}
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.title")}</h2>
        <p>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.description")}</p>
        <ul>
          {P0_ENGINES.map((entry) => (
            <li key={entry.runtimeAdapterId}>
              <Link href={`/w/engine/${entry.runtimeAdapterId}`}>{t(STUDENT_WEB_CATALOG_IT_IT, entry.nameKey)}</Link>
            </li>
          ))}
        </ul>
        <Link href="/w/sequence">{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.title")}</Link>
      </section>

      <Button type="button" variant="secondary" onClick={handleLogout}>
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.logoutButton")}
      </Button>
    </main>
  );
}
