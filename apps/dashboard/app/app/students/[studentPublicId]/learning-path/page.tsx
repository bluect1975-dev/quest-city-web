"use client";

import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../../../lib/staff-auth-context";
import { useAsync } from "../../../../../lib/useAsync";
import { staffErrorText } from "../../../../../lib/staff-error-text";
import { createLearningPathAlternative, createLearningPathPolicy, deleteLearningPathPolicy, getStudentLearningPathPreview, listLearningPathPolicies } from "../../../../../lib/staff-api-client";
import type { EffectiveResolution, LearningPathPolicy, LearningPathReasonCategory, LearningPathResourceType, LearningPathState } from "../../../../../lib/staff-api-types";
import { RESOURCE_TYPE_VALUES, REASON_CATEGORY_VALUES, STUDENT_STATE_VALUES } from "../../../../../lib/learning-path-constants";

/**
 * `/app/students/{studentPublicId}/learning-path` (02_41 v1.1 §21-23,
 * mission §60 scenarios C/D/E: per-student customization, waiver,
 * alternative). TEACHER (own class roster), SUPPORT_TEACHER (own ACTIVE
 * `support_student_assignment` or own assigned class), SCHOOL_ADMIN/
 * INDEPENDENT_EDUCATOR -- capability `learning_path.student.manage`/
 * `.waiver.manage`/`.preview`, server-enforced via
 * `resolveStudentSupportScope` on every call (never a second scope
 * check here). ASACOM is PROPOSE_ONLY (02_41 §22) -- never reaches this
 * direct-manage page.
 */
export default function StudentLearningPathPage() {
  const params = useParams<{ studentPublicId: string }>();
  return (
    <RequireStaffAuth>
      {(context) =>
        context.role === "ASACOM" ? (
          <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>
        ) : (
          <StudentLearningPathView studentPublicId={params.studentPublicId} />
        )
      }
    </RequireStaffAuth>
  );
}

function StudentLearningPathView({ studentPublicId }: { studentPublicId: string }) {
  const { csrfToken } = useStaffAuth();
  const policies = useAsync<LearningPathPolicy[]>(() => listLearningPathPolicies({ scope: "STUDENT", scopeRef: studentPublicId }), [studentPublicId]);
  const preview = useAsync<{ studentPublicId: string; nodes: EffectiveResolution[] }>(() => getStudentLearningPathPreview(studentPublicId), [studentPublicId]);

  const [resourceType, setResourceType] = useState<LearningPathResourceType>("UNIT_ELEMENT");
  const [resourceRef, setResourceRef] = useState("");
  const [state, setState] = useState<LearningPathState>("DISABLED_AND_WAIVED");
  const [reasonCategory, setReasonCategory] = useState<LearningPathReasonCategory>("TEMPORARY_SUPPORT");
  const [reasonNotes, setReasonNotes] = useState("");
  const [alternativeContentRef, setAlternativeContentRef] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [altOriginalResourceRef, setAltOriginalResourceRef] = useState("");
  const [altAlternativeContentRef, setAltAlternativeContentRef] = useState("");
  const [registeringAlt, setRegisteringAlt] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [altSuccess, setAltSuccess] = useState(false);

  async function handleRegisterAlternative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !altOriginalResourceRef.trim() || !altAlternativeContentRef.trim()) return;
    setRegisteringAlt(true);
    setAltError(null);
    setAltSuccess(false);
    try {
      await createLearningPathAlternative({
        originalResourceType: resourceType,
        originalResourceRef: altOriginalResourceRef.trim(),
        alternativeContentRef: altAlternativeContentRef.trim(),
        csrfToken,
      });
      setAltSuccess(true);
    } catch (error) {
      setAltError(staffErrorText(error));
    } finally {
      setRegisteringAlt(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !resourceRef.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createLearningPathPolicy({
        scope: "STUDENT",
        scopeRef: studentPublicId,
        resourceType,
        resourceRef: resourceRef.trim(),
        state,
        reasonCategory,
        reasonNotes: reasonNotes.trim() || undefined,
        alternativeContentRef: state === "DISABLED_WITH_ALTERNATIVE" ? alternativeContentRef.trim() || undefined : undefined,
        csrfToken,
      });
      setResourceRef("");
      setReasonNotes("");
      setAlternativeContentRef("");
      policies.reload();
      preview.reload();
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
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.title")}</h1>
      <p>{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.description")}</p>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeTitle")}</h2>
        <p>{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeDescription")}</p>
        <form onSubmit={handleRegisterAlternative}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeOriginalLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" required value={altOriginalResourceRef} onChange={(e) => setAltOriginalResourceRef(e.target.value)} />}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeContentLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" required value={altAlternativeContentRef} onChange={(e) => setAltAlternativeContentRef(e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={registeringAlt || !csrfToken || !altOriginalResourceRef.trim() || !altAlternativeContentRef.trim()}>
            {registeringAlt
              ? t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeSubmitting")
              : t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeSubmit")}
          </Button>
        </form>
        {altError ? <StatusMessage kind="error">{altError}</StatusMessage> : null}
        {altSuccess ? <p role="status">{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.registerAlternativeSuccess")}</p> : null}
      </section>

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
                {STUDENT_STATE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t(DASHBOARD_CATALOG_IT_IT, `app.learningPath.state.${value}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {state === "DISABLED_WITH_ALTERNATIVE" ? (
            <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.learningPath.alternativeContentRefLabel")}>
              {(fieldProps) => <input {...fieldProps} type="text" required value={alternativeContentRef} onChange={(e) => setAlternativeContentRef(e.target.value)} />}
            </FormField>
          ) : null}
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
                  row.sourceScope === "STUDENT" ? (
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
