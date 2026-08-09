"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../lib/student-auth-context";
import { getStudentContext, startStudentSession } from "../../../lib/student-api-client";
import { StudentApiError } from "../../../lib/student-api-error";

/**
 * `/w/login` (WEB-M4, 07_25 v1.0 §7-A, authorization §5/§16): real student
 * login UI reusing the existing `POST /web-auth/session/start` (no new
 * identity system). Not gated by an auth check — it IS the entry point;
 * redirects to `/w/home` once a session is established, mirroring
 * `apps/dashboard/app/app/login/page.tsx`'s pattern.
 */
export default function StudentLoginPage() {
  const { status, setSession } = useStudentAuth();
  const router = useRouter();
  const [classCode, setClassCode] = useState("");
  const [accessAlias, setAccessAlias] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" || status === "authenticated-read-only") {
      router.replace("/w/home");
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { csrfToken } = await startStudentSession({ classCode, accessAlias, pin });
      const context = await getStudentContext();
      setSession(context, csrfToken);
      router.replace("/w/home");
    } catch (caught) {
      setError(
        caught instanceof StudentApiError
          ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
          : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "login.title")}</h1>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "login.description")}</p>
      <form onSubmit={handleSubmit}>
        <FormField label={t(STUDENT_WEB_CATALOG_IT_IT, "login.classCodeLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              required
              minLength={4}
              maxLength={32}
              autoComplete="off"
              value={classCode}
              onChange={(event) => setClassCode(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t(STUDENT_WEB_CATALOG_IT_IT, "login.accessAliasLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              required
              minLength={1}
              maxLength={64}
              autoComplete="username"
              value={accessAlias}
              onChange={(event) => setAccessAlias(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t(STUDENT_WEB_CATALOG_IT_IT, "login.pinLabel")} hint={t(STUDENT_WEB_CATALOG_IT_IT, "login.pinHint")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="password"
              inputMode="numeric"
              required
              minLength={6}
              maxLength={8}
              pattern="[0-9]*"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          )}
        </FormField>
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? t(STUDENT_WEB_CATALOG_IT_IT, "login.submitting") : t(STUDENT_WEB_CATALOG_IT_IT, "login.submit")}
        </Button>
      </form>
    </main>
  );
}
