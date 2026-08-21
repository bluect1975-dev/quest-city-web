"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { usePlatformAuth } from "../../../../lib/platform-auth-context";
import { getPlatformContext, startPlatformSession } from "../../../../lib/platform-api-client";
import { platformErrorText } from "../../../../lib/platform-error-text";

/** `/app/platform-admin/login`. Not gated by `RequirePlatformAuth` -- it IS the auth entry point. */
export default function PlatformAdminLoginPage() {
  const { status, setSession } = usePlatformAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" || status === "authenticated-read-only") {
      router.replace("/app/platform-admin");
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { csrfToken } = await startPlatformSession({ email, password });
      const context = await getPlatformContext();
      setSession(context, csrfToken);
      router.replace("/app/platform-admin");
    } catch (caught) {
      setError(platformErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="qc-auth-page qc-admin-auth-page">
      <div className="qc-auth-brand">
        <BrandMark />
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.brandLabel")} · {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.brandBadge")}
      </div>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.login.title")}</h1>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.login.emailLabel")}>
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
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.login.passwordLabel")}>
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
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.login.submitting")
            : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.login.submit")}
        </Button>
      </form>
    </main>
  );
}
