"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { getStaffContext, startStaffSession } from "../../../lib/staff-api-client";
import { staffErrorText } from "../../../lib/staff-error-text";

/** `/app/login` (02_35 §4.1). Not gated by `RequireStaffAuth` — it IS the auth entry point; redirects away once a session is established. */
export default function StaffLoginPage() {
  const { status, setSession } = useStaffAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" || status === "authenticated-read-only") {
      router.replace("/app");
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { csrfToken } = await startStaffSession({ email, password, tenantId: tenantId || undefined });
      const context = await getStaffContext();
      setSession(context, csrfToken);
      router.replace("/app");
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="qc-auth-page">
      <div className="qc-auth-brand">{t(DASHBOARD_CATALOG_IT_IT, "app.brandLabel")}</div>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.login.title")}</h1>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.login.emailLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.login.passwordLabel")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.login.tenantIdLabel")} hint={t(DASHBOARD_CATALOG_IT_IT, "app.login.tenantIdHint")}>
          {(fieldProps) => (
            <input {...fieldProps} type="text" value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
          )}
        </FormField>
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? t(DASHBOARD_CATALOG_IT_IT, "app.login.submitting") : t(DASHBOARD_CATALOG_IT_IT, "app.login.submit")}
        </Button>
      </form>
    </main>
  );
}
