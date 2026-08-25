"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, FormField, Icon, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import { createClass, listClasses } from "../../../lib/staff-api-client";
import type { ClassSummary } from "../../../lib/staff-api-types";

/**
 * `/app/classes` (02_35 §5, §3.2, v1.2 §11bis.6, v1.4 §11ter.4). TEACHER
 * sees its explicit scope; SCHOOL_ADMIN and INDEPENDENT_EDUCATOR each see
 * their whole tenant and can create classes (`class.create`).
 */
export default function StaffClassesPage() {
  return (
    <RequireStaffAuth>
      {(context) => <ClassesView canCreate={context.role === "SCHOOL_ADMIN" || context.role === "INDEPENDENT_EDUCATOR"} />}
    </RequireStaffAuth>
  );
}

function ClassesView({ canCreate }: { canCreate: boolean }) {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<ClassSummary[]>(() => listClasses(), []);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createClass({ name, csrfToken });
      setName("");
      result.reload();
    } catch (error) {
      setCreateError(staffErrorText(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.classes.title")}</h1>

      {canCreate ? (
        <section className="qc-card">
          <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classes.createTitle")}</h2>
          <form onSubmit={handleCreate}>
            <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classes.createNameLabel")}>
              {(fieldProps) => <input {...fieldProps} type="text" required value={name} onChange={(e) => setName(e.target.value)} />}
            </FormField>
            <Button type="submit" disabled={creating || !csrfToken}>
              {creating ? t(DASHBOARD_CATALOG_IT_IT, "app.classes.createSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.classes.createSubmit")}
            </Button>
          </form>
          {createError ? <StatusMessage kind="error">{createError}</StatusMessage> : null}
        </section>
      ) : null}

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.classes.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <div className="qc-class-grid">
          {result.data.map((row) => (
            <Card key={row.classId} className="qc-class-grid-card">
              <span className="qc-class-grid-card-icon" aria-hidden="true">
                <Icon name="users" size={20} />
              </span>
              <h3>{row.name}</h3>
              <Link href={`/app/classes/${encodeURIComponent(row.classId)}`} className="qc-button qc-button-secondary">
                {t(DASHBOARD_CATALOG_IT_IT, "app.classes.openClass")}
              </Link>
            </Card>
          ))}
        </div>
      ) : null}
    </main>
  );
}
