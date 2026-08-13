"use client";

import { useAsync } from "./useAsync";
import { listMyTenantMemberships } from "./staff-api-client";
import type { TenantMembership } from "./staff-api-types";

/**
 * `GET /me/tenant-memberships` (02_35 v1.5 §11quater.5) -- self-read, no
 * capability required. Powers the tenant-switcher widget; same shared
 * loading/error/success/reload pattern as every other staff-session list
 * (`useAsync`).
 */
export function useTenantMemberships() {
  return useAsync<TenantMembership[]>(() => listMyTenantMemberships(), []);
}
