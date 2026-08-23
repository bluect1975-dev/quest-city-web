"use client";

import { useState } from "react";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import { getMyStaffProfile, updateMyStaffProfile } from "../../../lib/staff-api-client";
import type { StaffProfile } from "../../../lib/staff-api-types";

/**
 * `/app/profile` (Pilot Product Experience Residual Closure, Tranche H1) —
 * the self-service surface required to close `NEW-GAP-STAFF-DISPLAY-NAME-01`
 * (mission §9): no `profile`/`settings` route existed anywhere under
 * `apps/dashboard/app/app` before this tranche, so this is a new minimal
 * surface, not a duplicate of an existing one. Every role can reach it
 * (see `AppShell`'s unconditional nav item) — a name is not
 * role-specific. Backed by `GET`/`PATCH /me/staff-profile`.
 */
export default function ProfilePage() {
  return <RequireStaffAuth>{() => <ProfileView />}</RequireStaffAuth>;
}

function ProfileView() {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<StaffProfile>(() => getMyStaffProfile(), []);

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.profile.title")}</h1>
      <p>{t(DASHBOARD_CATALOG_IT_IT, "app.profile.description")}</p>

      {result.status === "loading" && <StatusMessage kind="loading">{t(DASHBOARD_CATALOG_IT_IT, "app.profile.loading")}</StatusMessage>}
      {result.status === "error" && <StatusMessage kind="error">{result.message}</StatusMessage>}

      {result.status === "success" && (
        <ProfileForm profile={result.data} csrfToken={csrfToken} onSaved={result.reload} />
      )}
    </main>
  );
}

/**
 * Only mounted once `result.status === "success"`, so `useState(profile.
 * displayName ?? "")` seeds the input from the real server value exactly
 * once, at mount — no `setState`-in-effect anti-pattern
 * (react-hooks/set-state-in-effect) needed. After a successful save the
 * local value already equals what was just persisted, so `onSaved()`'s
 * `reload()` (which re-fetches but does not remount this component) never
 * needs to resync the input from the response.
 */
function ProfileForm({
  profile,
  csrfToken,
  onSaved,
}: {
  profile: StaffProfile;
  csrfToken: string | null;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateMyStaffProfile({ displayName, csrfToken });
      setSaved(true);
      onSaved();
    } catch (error) {
      setSaveError(staffErrorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="qc-card">
      <dl className="qc-detail-list">
        <div>
          <dt>{t(DASHBOARD_CATALOG_IT_IT, "app.profile.emailLabel")}</dt>
          <dd>{profile.email}</dd>
        </div>
      </dl>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.profile.displayNameLabel")} hint={t(DASHBOARD_CATALOG_IT_IT, "app.profile.displayNameHint")}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              required
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          )}
        </FormField>
        <Button type="submit" disabled={saving || !csrfToken || displayName.trim().length === 0}>
          {saving ? t(DASHBOARD_CATALOG_IT_IT, "app.profile.saving") : t(DASHBOARD_CATALOG_IT_IT, "app.profile.save")}
        </Button>
      </form>
      {saveError && <StatusMessage kind="error">{saveError}</StatusMessage>}
      {saved && !saveError && <p role="status">{t(DASHBOARD_CATALOG_IT_IT, "app.profile.saved")}</p>}
    </section>
  );
}
