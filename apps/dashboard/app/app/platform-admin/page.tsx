"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, FormField, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../lib/RequirePlatformAuth";
import { usePlatformAuth } from "../../../lib/platform-auth-context";
import { useAsyncPlatform } from "../../../lib/useAsyncPlatform";
import {
  activateSchoolAdmin,
  createTenant,
  generateIdempotencyKey,
  listTenants,
  setTenantStatus,
} from "../../../lib/platform-api-client";
import { platformErrorText } from "../../../lib/platform-error-text";
import type { Capability, PlatformContext, TenantSummary } from "../../../lib/platform-api-types";

/** `/app/platform-admin`. Tenant list + create school + suspend/reactivate + first School Admin activation -- the minimal UI this tranche requires (§15). No didactic data view is ever reachable from here. */
export default function PlatformAdminHomePage() {
  return <RequirePlatformAuth>{(context) => <PlatformAdminHomeView context={context} />}</RequirePlatformAuth>;
}

function hasCapability(capabilities: Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}

function PlatformAdminHomeView({ context }: { context: PlatformContext }) {
  const { csrfToken, logout } = usePlatformAuth();
  const router = useRouter();
  const result = useAsyncPlatform<TenantSummary[]>(() => listTenants(), []);
  const canCreate = hasCapability(context.capabilities, "tenant.create");
  const canSuspend = hasCapability(context.capabilities, "tenant.suspend");
  const canActivateSchoolAdmin = hasCapability(context.capabilities, "school_admin.activate");
  const canReadAudit = hasCapability(context.capabilities, "audit.read.global");

  async function handleLogout() {
    await logout();
    router.replace("/app/platform-admin/login");
  }

  return (
    <main>
      <nav>
        {canReadAudit ? <Link href="/app/platform-admin/audit">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.nav.audit")}</Link> : null}
        <Button type="button" onClick={handleLogout}>
          {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.nav.logout")}
        </Button>
      </nav>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            { key: "name", header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.columnName"), render: (row) => row.name },
            {
              key: "publicId",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.columnPublicId"),
              render: (row) => row.publicId,
            },
            {
              key: "status",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.columnStatus"),
              render: (row) =>
                row.status === "ACTIVE"
                  ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.statusActive")
                  : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.statusSuspended"),
            },
            {
              key: "createdAt",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.columnCreatedAt"),
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
            {
              key: "statusAction",
              header: "",
              render: (row) =>
                canSuspend ? (
                  <TenantStatusAction tenant={row} csrfToken={csrfToken ?? ""} onDone={result.reload} />
                ) : null,
            },
            {
              key: "activateSchoolAdmin",
              header: "",
              render: (row) =>
                canActivateSchoolAdmin && row.status === "ACTIVE" ? (
                  <SchoolAdminActivationForm tenantId={row.id} csrfToken={csrfToken ?? ""} />
                ) : null,
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.id}
        />
      ) : null}

      {canCreate ? <CreateTenantForm csrfToken={csrfToken ?? ""} onCreated={result.reload} /> : null}
    </main>
  );
}

function CreateTenantForm({ csrfToken, onCreated }: { csrfToken: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createTenant({ name, csrfToken, idempotencyKey: generateIdempotencyKey() });
      setName("");
      onCreated();
    } catch (caught) {
      setError(platformErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.createTitle")}</h2>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.createNameLabel")}>
          {(fieldProps) => (
            <input {...fieldProps} type="text" required value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </FormField>
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.createSubmitting")
            : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.createSubmit")}
        </Button>
      </form>
    </section>
  );
}

function TenantStatusAction({
  tenant,
  csrfToken,
  onDone,
}: {
  tenant: TenantSummary;
  csrfToken: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      await setTenantStatus({
        tenantId: tenant.id,
        status: tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
        csrfToken,
      });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="button" disabled={submitting} onClick={handleClick}>
      {tenant.status === "ACTIVE"
        ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.suspendAction")
        : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.reactivateAction")}
    </Button>
  );
}

function SchoolAdminActivationForm({ tenantId, csrfToken }: { tenantId: string; csrfToken: string }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResultMessage(null);
    try {
      const activation = await activateSchoolAdmin({ tenantId, email, csrfToken });
      if (activation.reactivated) {
        setResultMessage(t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminResultReactivated"));
      } else if (activation.identityReused) {
        setResultMessage(t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminResultReused"));
      } else {
        setResultMessage(
          `${t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminResultNew")} ${activation.temporaryPassword ?? ""}`,
        );
      }
      setEmail("");
    } catch (caught) {
      setError(platformErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormField label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminEmailLabel")}>
        {(fieldProps) => (
          <input {...fieldProps} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        )}
      </FormField>
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
      {resultMessage ? <p role="status">{resultMessage}</p> : null}
      <Button type="submit" disabled={submitting}>
        {submitting
          ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminSubmitting")
          : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.tenants.activateSchoolAdminSubmit")}
      </Button>
    </form>
  );
}
