"use client";

import { useState, type FormEvent } from "react";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import { createLearningPathPolicy, deleteLearningPathPolicy, listLearningPathPolicies } from "../../../lib/staff-api-client";
import type { LearningPathPolicy, LearningPathReasonCategory, LearningPathResourceType, LearningPathState } from "../../../lib/staff-api-types";
import { RESOURCE_TYPE_VALUES, REASON_CATEGORY_VALUES, SCHOOL_STATE_VALUES } from "../../../lib/learning-path-constants";

/**
 * `/app/learning-path-policies` (02_41 v1.1 §16, mission §60 scenario A:
 * "School Admin → curriculum/path control → disable Unit Element").
 * SCHOOL_ADMIN-only: manages the SCHOOL-scope defaults that every Class/
 * Student in the tenant inherits unless explicitly overridden. There is
 * no curriculum_profile/class_curriculum_module table in this schema to
 * enumerate a full tree from (migration 0013 header) -- resourceType/
 * resourceRef are entered directly, matching the opaque-identity model
 * the resolver and OpenAPI v1.15.0 contract already use.
 */
export default function LearningPathPoliciesPage() {
  return (
    <RequireStaffAuth>
      {(context) => (context.role === "SCHOOL_ADMIN" ? <SchoolPolicyView /> : <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>)}
    </RequireStaffAuth>
  );
}

function SchoolPolicyView() {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<LearningPathPolicy[]>(() => listLearningPathPolicies({ scope: "SCHOOL" }), []);

  const [resourceType, setResourceType] = useState<LearningPathResourceType>("UNIT_ELEMENT");
  const [resourceRef, setResourceRef] = useState("");
  const [state, setState] = useState<LearningPathState>("DISABLED");
  const [reasonCategory, setReasonCategory] = useState<LearningPathReasonCategory>("PEDAGOGICAL");
  const [reasonNotes, setReasonNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !resourceRef.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createLearningPathPolicy({
        scope: "SCHOOL",
        resourceType,
        resourceRef: resourceRef.trim(),
        state,
        reasonCategory,
        reasonNotes: reasonNotes.trim() || undefined,
        csrfToken,
      });
      setResourceRef("");
      setReasonNotes("");
      result.reload();
    } catch (error) {
      setCreateError(staffErrorText(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(policyId: string) {
    if (!csrfToken) return;
    setDeletingId(policyId);
    try {
      await deleteLearningPathPolicy({ policyId, csrfToken });
      result.reload();
    } catch (error) {
      setCreateError(staffErrorText(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.learningPathPolicies.title")}</h1>
      <p>{t(DASHBOARD_CATALOG_IT_IT, "app.learningPathPolicies.description")}</p>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.createFormTitle")}</h2>
        <form onSubmit={handleCreate}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.resourceTypeLabel")}>
            {(fieldProps) => (
              <select {...fieldProps} value={resourceType} onChange={(e) => setResourceType(e.target.value as LearningPathResourceType)}>
                {RESOURCE_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.resourceType.${value}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.resourceRefLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" required value={resourceRef} onChange={(e) => setResourceRef(e.target.value)} />}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.stateLabel")}>
            {(fieldProps) => (
              <select {...fieldProps} value={state} onChange={(e) => setState(e.target.value as LearningPathState)}>
                {SCHOOL_STATE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.state.${value}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.reasonCategoryLabel")}>
            {(fieldProps) => (
              <select {...fieldProps} value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as LearningPathReasonCategory)}>
                {REASON_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.reasonCategory.${value}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.reasonNotesLabel")}>
            {(fieldProps) => <textarea {...fieldProps} value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)} maxLength={2000} />}
          </FormField>
          <Button type="submit" disabled={creating || !csrfToken || !resourceRef.trim()}>
            {creating ? t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.createSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.createSubmit")}
          </Button>
        </form>
        {createError ? <StatusMessage kind="error">{createError}</StatusMessage> : null}
      </section>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.empty")} /> : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            {
              key: "resource",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.columnResource"),
              render: (row: LearningPathPolicy) => `${t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.resourceType.${row.resourceType}`)}: ${row.resourceRef}`,
            },
            {
              key: "state",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.columnState"),
              render: (row: LearningPathPolicy) => (
                <StatusBadge tone={row.state === "ENABLED" ? "success" : "warning"}>{t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.state.${row.state}`)}</StatusBadge>
              ),
            },
            {
              key: "reason",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.columnReason"),
              render: (row: LearningPathPolicy) => t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.reasonCategory.${row.reasonCategory}`),
            },
            {
              key: "actions",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.columnActions"),
              render: (row: LearningPathPolicy) => (
                <Button variant="secondary" disabled={deletingId === row.id || !csrfToken} onClick={() => void handleDelete(row.id)}>
                  {t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.deleteButton")}
                </Button>
              ),
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.id}
        />
      ) : null}
    </main>
  );
}
