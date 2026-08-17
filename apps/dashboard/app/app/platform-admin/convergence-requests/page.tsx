"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../lib/RequirePlatformAuth";

/**
 * `/app/platform-admin/convergence-requests` (contracts/quest-city-platform-openapi-v1_12.yaml).
 *
 * Known minimal-UI scoping decision: no `listConvergenceRequests`-equivalent
 * route was scoped for the Platform Admin surface in this pass (the task
 * brief for this tranche explicitly calls this out) -- there is no
 * "list all convergence requests" screen here. Instead this page is a
 * lookup-by-id form: entering an id navigates straight to the detail page
 * (`/app/platform-admin/convergence-requests/{id}`), which performs the
 * real `GET /convergence-requests/{id}` fetch.
 */
export default function PlatformAdminConvergenceRequestsPage() {
  return <RequirePlatformAuth>{() => <ConvergenceRequestLookupView />}</RequirePlatformAuth>;
}

function ConvergenceRequestLookupView() {
  const router = useRouter();
  const [requestId, setRequestId] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    router.push(`/app/platform-admin/convergence-requests/${encodeURIComponent(requestId)}`);
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequests.title")}</h1>
      <section className="qc-card">
        <p>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequests.lookupHint")}</p>
        <form onSubmit={handleSubmit}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequests.idLabel")}>
            {(fieldProps) => (
              <input {...fieldProps} type="text" required value={requestId} onChange={(e) => setRequestId(e.target.value)} />
            )}
          </FormField>
          <Button type="submit">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequests.submit")}</Button>
        </form>
      </section>
    </main>
  );
}
