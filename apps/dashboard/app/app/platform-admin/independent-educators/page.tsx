"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, EmptyState, FormField, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../lib/RequirePlatformAuth";
import { usePlatformAuth } from "../../../../lib/platform-auth-context";
import { useAsyncPlatform } from "../../../../lib/useAsyncPlatform";
import {
  activateIndependentEducator,
  generateIdempotencyKey,
  listIndependentEducators,
  setIndependentEducatorStatus,
} from "../../../../lib/platform-api-client";
import { platformErrorText } from "../../../../lib/platform-error-text";
import type { Capability, IndependentEducatorSummary, PlatformContext } from "../../../../lib/platform-api-types";

function hasCapability(capabilities: Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}

/**
 * `/app/platform-admin/independent-educators` (02_26 v1.13 §35, 02_38 v1.3
 * §19). List, activate, suspend/reactivate -- the minimal Independent
 * Educator UI this tranche requires. No didactic data view is ever
 * reachable from here (§35.3: "nessun dato didattico").
 */
export default function PlatformAdminIndependentEducatorsPage() {
  return <RequirePlatformAuth>{(context) => <IndependentEducatorsView context={context} />}</RequirePlatformAuth>;
}

function IndependentEducatorsView({ context }: { context: PlatformContext }) {
  const { csrfToken } = usePlatformAuth();
  const result = useAsyncPlatform<IndependentEducatorSummary[]>(() => listIndependentEducators(), []);
  const canActivate = hasCapability(context.capabilities, "independent_educator.activate");
  const canManageStatus = hasCapability(context.capabilities, "independent_educator.status.manage");

  return (
    <main>
      <nav>
        <Link href="/app/platform-admin">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.nav.tenants")}</Link>
      </nav>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            {
              key: "tenantName",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.columnTenantName"),
              render: (row) => row.tenantName,
            },
            {
              key: "email",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.columnEmail"),
              render: (row) => row.email,
            },
            {
              key: "tenantStatus",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.columnTenantStatus"),
              render: (row) =>
                row.tenantStatus === "ACTIVE"
                  ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.statusActive")
                  : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.statusSuspended"),
            },
            {
              key: "membershipStatus",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.columnMembershipStatus"),
              render: (row) =>
                row.membershipStatus === "ACTIVE"
                  ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.statusActive")
                  : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.statusSuspended"),
            },
            {
              key: "createdAt",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.columnCreatedAt"),
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
            {
              key: "statusAction",
              header: "",
              render: (row) =>
                canManageStatus ? (
                  <IndependentEducatorStatusAction tenant={row} csrfToken={csrfToken ?? ""} onDone={result.reload} />
                ) : null,
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.tenantId}
        />
      ) : null}

      {canActivate ? <ActivateIndependentEducatorForm csrfToken={csrfToken ?? ""} onCreated={result.reload} /> : null}
    </main>
  );
}

function IndependentEducatorStatusAction({
  tenant,
  csrfToken,
  onDone,
}: {
  tenant: IndependentEducatorSummary;
  csrfToken: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      await setIndependentEducatorStatus({
        tenantId: tenant.tenantId,
        status: tenant.tenantStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
        csrfToken,
      });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="button" disabled={submitting} onClick={handleClick}>
      {tenant.tenantStatus === "ACTIVE"
        ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.suspendAction")
        : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.reactivateAction")}
    </Button>
  );
}

function ActivateIndependentEducatorForm({ csrfToken, onCreated }: { csrfToken: string; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResultMessage(null);
    try {
      const activation = await activateIndependentEducator({
        email,
        tenantName,
        csrfToken,
        idempotencyKey: generateIdempotencyKey(),
      });
      if (activation.identityReused) {
        setResultMessage(t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createResultReused"));
      } else {
        setResultMessage(
          `${t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createResultNew")} ${activation.temporaryPassword ?? ""}`,
        );
      }
      setEmail("");
      setTenantName("");
      onCreated();
    } catch (caught) {
      setError(platformErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createTitle")}</h2>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createEmailLabel")}>
          {(fieldProps) => (
            <input {...fieldProps} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          )}
        </FormField>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createTenantNameLabel")}>
          {(fieldProps) => (
            <input {...fieldProps} type="text" required value={tenantName} onChange={(event) => setTenantName(event.target.value)} />
          )}
        </FormField>
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        {resultMessage ? <p role="status">{resultMessage}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createSubmitting")
            : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.independentEducators.createSubmit")}
        </Button>
      </form>
    </section>
  );
}
