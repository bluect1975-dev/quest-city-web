"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { getStaffContext, startStaffSession } from "../../../lib/staff-api-client";
import { staffErrorText } from "../../../lib/staff-error-text";
import { StaffApiError } from "../../../lib/staff-api-error";
import { ROLE_LABEL_KEY } from "../../../lib/role-labels";
import type { StaffRole } from "../../../lib/staff-api-types";

interface AmbiguousMembershipCandidate {
  staffTenantMembershipId: string;
  role: StaffRole;
}

/** `/app/login` (02_35 §4.1). Not gated by `RequireStaffAuth` — it IS the auth entry point; redirects away once a session is established. */
export default function StaffLoginPage() {
  const { status, setSession } = useStaffAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same-tenant multi-role (02_25 v1.12 §6.16.6): when tenantId alone still
  // matches more than one ACTIVE membership, the server returns 409
  // AMBIGUOUS_TENANT_MEMBERSHIP with the candidate list in safeDetails --
  // this replaces the plain error banner with a role picker so the human
  // can complete login at all, mirroring ActiveRoleSwitcher's post-login
  // disambiguation for the pre-login case.
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<AmbiguousMembershipCandidate[] | null>(null);
  const [selectedMembershipId, setSelectedMembershipId] = useState("");

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
      const { csrfToken } = await startStaffSession({
        email,
        password,
        tenantId: tenantId || undefined,
        staffTenantMembershipId: ambiguousCandidates ? selectedMembershipId : undefined,
      });
      const context = await getStaffContext();
      setSession(context, csrfToken);
      router.replace("/app");
    } catch (caught) {
      if (caught instanceof StaffApiError && caught.code === "AMBIGUOUS_TENANT_MEMBERSHIP") {
        const candidates = (caught.safeDetails?.candidates ?? []) as AmbiguousMembershipCandidate[];
        setAmbiguousCandidates(candidates);
        setSelectedMembershipId(candidates[0]?.staffTenantMembershipId ?? "");
        setError(null);
      } else {
        setError(staffErrorText(caught));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="qc-auth-page">
      <div className="qc-auth-brand">
        <BrandMark />
        {t(DASHBOARD_CATALOG_IT_IT, "app.brandLabel")}
      </div>
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
        {ambiguousCandidates && ambiguousCandidates.length > 0 ? (
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.login.roleLabel")} hint={t(DASHBOARD_CATALOG_IT_IT, "app.login.roleHint")}>
            {(fieldProps) => (
              <select
                {...fieldProps}
                value={selectedMembershipId}
                onChange={(event) => setSelectedMembershipId(event.target.value)}
              >
                {ambiguousCandidates.map((candidate) => (
                  <option key={candidate.staffTenantMembershipId} value={candidate.staffTenantMembershipId}>
                    {t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[candidate.role])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : null}
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? t(DASHBOARD_CATALOG_IT_IT, "app.login.submitting") : t(DASHBOARD_CATALOG_IT_IT, "app.login.submit")}
        </Button>
      </form>
    </main>
  );
}
