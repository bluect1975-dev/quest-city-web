"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { acceptStaffInvitation } from "../../../../lib/staff-api-client";
import { staffErrorText } from "../../../../lib/staff-error-text";

/** `/app/staff/accept-invitation?token=...` (02_35 v1.2 §11bis.3). Public — no session, no CSRF token; the invitation token itself is the credential. */
export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationForm />
    </Suspense>
  );
}

function AcceptInvitationForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await acceptStaffInvitation({ token, password: password || undefined });
      setSuccess(true);
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main>
        <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.title")}</h1>
        <p role="status">{t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.success")}</p>
        <Link href="/app/login">{t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.goToLogin")}</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.title")}</h1>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.tokenLabel")}>
          {(fieldProps) => <input {...fieldProps} type="text" required readOnly value={token} />}
        </FormField>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.passwordLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </FormField>
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting || !token}>
          {submitting ? t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.submitting") : t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.submit")}
        </Button>
      </form>
    </main>
  );
}
