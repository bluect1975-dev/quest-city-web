"use client";

import { useState } from "react";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useTenantMemberships } from "./useTenantMemberships";
import { switchSessionTenant } from "./staff-api-client";
import { staffErrorText } from "./staff-error-text";
import { ROLE_LABEL_KEY } from "./role-labels";
import type { StaffContext, TenantMembership } from "./staff-api-types";

function membershipLabel(membership: TenantMembership): string {
  const tenantLabel = membership.tenantName ?? membership.tenantId;
  const roleLabel = t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[membership.role]);
  return `${tenantLabel} — ${roleLabel}`;
}

/**
 * Promotes the per-page `TenantSwitcher` (previously only on
 * `/app/convergence`) into a shared header widget (§8 of the Student
 * Support Roles Web Implementation instruction). Supports switching
 * across tenants AND, since same-tenant multi-role became possible
 * (02_25 v1.12 §6.16.6, e.g. TEACHER + SUPPORT_TEACHER in one school),
 * switching between two memberships on the SAME tenant --
 * `staffTenantMembershipId` disambiguates, always sent explicitly so the
 * server never has to guess (409 AMBIGUOUS_TENANT_MEMBERSHIP otherwise).
 * Rendered only when the identity holds more than one ACTIVE membership
 * -- a single-membership identity sees the plain tenant/role label
 * instead (unchanged from before this component existed).
 */
export function ActiveRoleSwitcher({ context, csrfToken }: { context: StaffContext; csrfToken: string | null }) {
  const memberships = useTenantMemberships();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (memberships.status !== "success" || memberships.data.length <= 1) {
    return null;
  }

  const current = memberships.data.find((m) => m.tenantId === context.tenantId && m.role === context.role);

  async function handleChange(staffTenantMembershipId: string) {
    if (!csrfToken || memberships.status !== "success") return;
    const target = memberships.data.find((m) => m.staffTenantMembershipId === staffTenantMembershipId);
    if (!target) return;
    setSwitching(true);
    setError(null);
    try {
      await switchSessionTenant({ tenantId: target.tenantId, staffTenantMembershipId: target.staffTenantMembershipId, csrfToken });
      window.location.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
      setSwitching(false);
    }
  }

  return (
    <div className="qc-shell-role-switcher">
      <label htmlFor="qc-active-role-switcher" className="qc-visually-hidden">
        {t(DASHBOARD_CATALOG_IT_IT, "app.roleSwitcher.label")}
      </label>
      <select
        id="qc-active-role-switcher"
        value={current?.staffTenantMembershipId ?? ""}
        disabled={switching}
        onChange={(event) => void handleChange(event.target.value)}
      >
        {memberships.data.map((membership) => (
          <option key={membership.staffTenantMembershipId} value={membership.staffTenantMembershipId}>
            {membershipLabel(membership)}
          </option>
        ))}
      </select>
      {error ? (
        <span className="qc-status qc-status-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
