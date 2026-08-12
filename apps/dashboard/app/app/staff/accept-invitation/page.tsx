"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { acceptStaffInvitation } from "../../../../lib/staff-api-client";
import { staffErrorText } from "../../../../lib/staff-error-text";

/**
 * `/app/staff/accept-invitation` (02_35 v1.2 §11bis.3, corrected per
 * 07_16 v1.2 §7.2/§9/§16 and 02_26 v1.12 §34 non-conformity classification).
 * Public — no session, no CSRF token; the invitation token itself is the
 * credential. The token is NEVER read from the URL (query string, path,
 * or fragment): it is entered manually by the Teacher and sent exclusively
 * in the JSON body of `POST /staff/invitations/accept`. This deliberately
 * departs from a typical "click-the-link" invitation UX because the
 * canonical token policy (02_27 §18, 02_35 §11bis.3) forbids the token
 * from ever appearing in a URL or being logged by any intermediary
 * (browser history, proxy access logs, referrer headers, analytics).
 */
export default function AcceptInvitationPage() {
  const [token, setToken] = useState("");
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
        <p>{t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.tokenHint")}</p>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.tokenLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              required
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t(DASHBOARD_CATALOG_IT_IT, "app.acceptInvitation.tokenPlaceholder")}
              value={token}
              onChange={(event) => setToken(event.target.value.trim())}
            />
          )}
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
