"use client";

import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../../../lib/staff-auth-context";
import { useAsync } from "../../../../../lib/useAsync";
import { staffErrorText } from "../../../../../lib/staff-error-text";
import { createLearningPathPolicy, deleteLearningPathPolicy, getClassLearningPathPreview, listLearningPathPolicies } from "../../../../../lib/staff-api-client";
import type { EffectiveResolution, LearningPathPolicy, LearningPathReasonCategory, LearningPathResourceType, LearningPathState } from "../../../../../lib/staff-api-types";
import { RESOURCE_TYPE_VALUES, REASON_CATEGORY_VALUES, SCHOOL_STATE_VALUES } from "../../../../../lib/learning-path-constants";

/**
 * `/app/classes/{classId}/learning-path` (02_41 v1.1 §17-20, mission §60
 * scenario B: "Teacher → inherited School restriction → locked state →
 * configure allowed Class element → preview Class"). TEACHER (own class),
 * SUPPORT_TEACHER (own assigned class), SCHOOL_ADMIN/INDEPENDENT_EDUCATOR
 * (tenant-wide) -- capability `learning_path.class.manage`/`.preview`,
 * server-enforced on every call (`assertClassInScope`,
 * `LEARNING_PATH_PARENT_DISABLED` if a School-level restriction is
 * currently effective and this write would re-enable through it).
 */
export default function ClassLearningPathPage() {
  const params = useParams<{ classId: string }>();
  return (
    <RequireStaffAuth>
      {(context) =>
        context.role === "ASACOM" ? (
          <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>
        ) : (
          <ClassLearningPathView classId={params.classId} />
        )
      }
    </RequireStaffAuth>
  );
}

function ClassLearningPathView({ classId }: { classId: string }) {
  const { csrfToken } = useStaffAuth();
  const policies = useAsync<LearningPathPolicy[]>(() => listLearningPathPolicies({ scope: "CLASS", scopeRef: classId }), [classId]);
  const preview = useAsync<{ classId: string; nodes: EffectiveResolution[] }>(() => getClassLearningPathPreview(classId), [classId]);

  const [resourceType, setResourceType] = useState<LearningPathResourceType>("UNIT_ELEMENT");
  const [resourceRef, setResourceRef] = useState("");
  const [state, setState] = useState<LearningPathState>("DISABLED");
  const [reasonCategory, setReasonCategory] = useState<LearningPathReasonCategory>("TEACHER_DECISION");
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
        scope: "CLASS",
        scopeRef: classId,
        resourceType,
        resourceRef: resourceRef.trim(),
        state,
        reasonCategory,
        reasonNotes: reasonNotes.trim() || undefined,
        csrfToken,
      });
      setResourceRef("");
      setReasonNotes("");
      policies.reload();
      preview.reload();
    } catch (error) {
      // LEARNING_PATH_PARENT_DISABLED surfaces here, already localized
      // ("Un livello superiore ha già disattivato questo contenuto...") --
      // this is the mandatory "Teacher overrides School DISABLED → DENY"
      // behaviour (mission §45), server-enforced and explained, not just
      // silently rejected.
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
      policies.reload();
      preview.reload();
    } catch (error) {
      setCreateError(staffErrorText(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main>
      <p>
        <Link href={`/app/classes/${encodeURIComponent(classId)}`}>{t(DASHBOARD_CATALOG_IT_IT, "app.classLearningPath.backToClass")}</Link>
      </p>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.classLearningPath.title")}</h1>
      <p>{t(DASHBOARD_CATALOG_IT_IT, "app.classLearningPath.description")}</p>

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

      {policies.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {policies.status === "error" ? <StatusMessage kind="error">{policies.message}</StatusMessage> : null}
      {policies.status === "success" && policies.data.length === 0 ? <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.empty")} /> : null}
      {policies.status === "success" && policies.data.length > 0 ? (
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
                <>
                  <StatusBadge tone={row.state === "ENABLED" ? "success" : "warning"}>{t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.state.${row.state}`)}</StatusBadge>
                  {row.shadowed ? (
                    <div>
                      <StatusBadge tone="neutral">{t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.shadowedNotice")}</StatusBadge>
                    </div>
                  ) : null}
                </>
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
          rows={policies.data}
          rowKey={(row) => row.id}
        />
      ) : null}

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewTitle")}</h2>
        {preview.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {preview.status === "error" ? <StatusMessage kind="error">{preview.message}</StatusMessage> : null}
        {preview.status === "success" && preview.data.nodes.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewEmpty")} />
        ) : null}
        {preview.status === "success" && preview.data.nodes.length > 0 ? (
          <Table
            columns={[
              {
                key: "resource",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewColumnResource"),
                render: (row: EffectiveResolution) => `${t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.resourceType.${row.resourceType}`)}: ${row.resourceRef}`,
              },
              {
                key: "availability",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewColumnAvailability"),
                render: (row: EffectiveResolution) => (
                  <StatusBadge tone={row.effectiveAvailability === "EFFECTIVE_AVAILABLE" ? "success" : "danger"}>
                    {t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.availability.${row.effectiveAvailability}`)}
                  </StatusBadge>
                ),
              },
              {
                key: "source",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewColumnSource"),
                render: (row: EffectiveResolution) =>
                  row.sourceScope === "CLASS" ? (
                    t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.scope.${row.sourceScope}`)
                  ) : (
                    <StatusBadge tone="info">{t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.scope.${row.sourceScope}`)}</StatusBadge>
                  ),
              },
              {
                key: "requirement",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.previewColumnRequirement"),
                render: (row: EffectiveResolution) => t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.requirement.${row.effectiveRequirement}`),
              },
            ]}
            rows={preview.data.nodes}
            rowKey={(row) => `${row.resourceType}:${row.resourceRef}`}
          />
        ) : null}
      </section>
    </main>
  );
}
