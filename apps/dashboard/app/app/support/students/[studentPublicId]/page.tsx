"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, EmptyState, FormField, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../../../lib/staff-auth-context";
import { useAsync } from "../../../../../lib/useAsync";
import { staffErrorText } from "../../../../../lib/staff-error-text";
import {
  applyAsacomFacilitationTemporary,
  applySupportTeacherFacilitation,
  createFacilitationProposal,
  createObservation,
  createSupportEvent,
  createSupportTeacherDifficultyOverride,
  getStudentFacilitation,
  listFacilitationProposalsForStudent,
  listSupportEvents,
  listSupportObservations,
  supersedeObservation,
  withdrawFacilitationProposal,
} from "../../../../../lib/staff-api-client";
import type {
  FacilitationProposalType,
  LearningSupportEvent,
  ObservationHistoryEntry,
  StaffContext,
  SupportIntensity,
  SupportProfileCategory,
  SupportProfileEntry,
  SupportType,
} from "../../../../../lib/staff-api-types";

const SUPPORT_TYPES: SupportType[] = [
  "COMMUNICATION_SUPPORT",
  "COMPREHENSION_SUPPORT",
  "ATTENTION_SUPPORT",
  "MOTOR_INTERACTION_SUPPORT",
  "NAVIGATION_SUPPORT",
  "EMOTIONAL_REGULATION_SUPPORT",
  "TASK_ORGANIZATION_SUPPORT",
  "ACCESSIBILITY_FACILITATION",
  "OTHER_STRUCTURED",
];
const SUPPORT_TYPE_LABEL_KEY: Record<SupportType, string> = {
  COMMUNICATION_SUPPORT: "app.supportStudentDetail.supportTypeCommunication",
  COMPREHENSION_SUPPORT: "app.supportStudentDetail.supportTypeComprehension",
  ATTENTION_SUPPORT: "app.supportStudentDetail.supportTypeAttention",
  MOTOR_INTERACTION_SUPPORT: "app.supportStudentDetail.supportTypeMotorInteraction",
  NAVIGATION_SUPPORT: "app.supportStudentDetail.supportTypeNavigation",
  EMOTIONAL_REGULATION_SUPPORT: "app.supportStudentDetail.supportTypeEmotionalRegulation",
  TASK_ORGANIZATION_SUPPORT: "app.supportStudentDetail.supportTypeTaskOrganization",
  ACCESSIBILITY_FACILITATION: "app.supportStudentDetail.supportTypeAccessibilityFacilitation",
  OTHER_STRUCTURED: "app.supportStudentDetail.supportTypeOtherStructured",
};
const INTENSITIES: SupportIntensity[] = ["NONE", "MINIMAL", "MODERATE", "SIGNIFICANT"];
const INTENSITY_LABEL_KEY: Record<SupportIntensity, string> = {
  NONE: "app.supportStudentDetail.intensityNone",
  MINIMAL: "app.supportStudentDetail.intensityMinimal",
  MODERATE: "app.supportStudentDetail.intensityModerate",
  SIGNIFICANT: "app.supportStudentDetail.intensitySignificant",
};
const CATEGORIES: SupportProfileCategory[] = ["PRESENTATION", "TIME_AND_LOAD", "TOOLS", "RESPONSE", "FEEDBACK", "ASSESSMENT", "SUBJECT"];
const CATEGORY_LABEL_KEY: Record<SupportProfileCategory, string> = {
  PRESENTATION: "app.supportStudentDetail.categoryPresentation",
  TIME_AND_LOAD: "app.supportStudentDetail.categoryTimeAndLoad",
  TOOLS: "app.supportStudentDetail.categoryTools",
  RESPONSE: "app.supportStudentDetail.categoryResponse",
  FEEDBACK: "app.supportStudentDetail.categoryFeedback",
  ASSESSMENT: "app.supportStudentDetail.categoryAssessment",
  SUBJECT: "app.supportStudentDetail.categorySubject",
};

/**
 * `/app/support/students/{studentPublicId}` (02_39 §16, §21bis, §22).
 * ASACOM and SUPPORT_TEACHER only (§6bis, §11quinquies.4/§11sexies.4) --
 * server-side scope enforcement happens again on every API call this
 * page makes; this role gate is UX only.
 */
export default function SupportStudentDetailPage() {
  return (
    <RequireStaffAuth>
      {(context) => (context.role === "ASACOM" || context.role === "SUPPORT_TEACHER" ? <SupportStudentDetailView context={context} /> : <NotAuthorized />)}
    </RequireStaffAuth>
  );
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

type TimelineEntry = { key: string; type: "event" | "observation" | "proposal"; occurredAt: string; label: string; actorRole?: string; status?: string };

function SupportStudentDetailView({ context }: { context: StaffContext }) {
  const params = useParams<{ studentPublicId: string }>();
  const studentPublicId = decodeURIComponent(params.studentPublicId);
  const { csrfToken } = useStaffAuth();
  const isAsacom = context.role === "ASACOM";

  const facilitation = useAsync<SupportProfileEntry[]>(() => getStudentFacilitation(studentPublicId), [studentPublicId]);
  const events = useAsync<LearningSupportEvent[]>(() => listSupportEvents(studentPublicId), [studentPublicId]);
  const observations = useAsync<ObservationHistoryEntry[]>(() => listSupportObservations(studentPublicId), [studentPublicId]);
  const proposals = useAsync(() => listFacilitationProposalsForStudent(studentPublicId), [studentPublicId]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // -- Facilitation apply form state --
  const [facCategory, setFacCategory] = useState<SupportProfileCategory>("TOOLS");
  const [facLevel, setFacLevel] = useState<"SESSION_ONLY" | "PROFILE_LEVEL">("SESSION_ONLY");

  async function handleApplyFacilitation(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      if (isAsacom) {
        await applyAsacomFacilitationTemporary({ studentPublicId, csrfToken });
      } else {
        await applySupportTeacherFacilitation({ studentPublicId, category: facCategory, level: facLevel, csrfToken });
      }
      facilitation.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  // -- Difficulty override form state (SUPPORT_TEACHER only) --
  const [targetRef, setTargetRef] = useState("");
  const [reason, setReason] = useState("");

  async function handleDifficultyOverride(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await createSupportTeacherDifficultyOverride({ studentPublicId, targetRef, reason, csrfToken });
      setTargetRef("");
      setReason("");
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  // -- Support event form state --
  const [attemptId, setAttemptId] = useState("");
  const [supportType, setSupportType] = useState<SupportType>("COMMUNICATION_SUPPORT");
  const [intensity, setIntensity] = useState<SupportIntensity>("MINIMAL");
  const [duration, setDuration] = useState("");

  async function handleCreateEvent(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await createSupportEvent({
        actorRole: context.role as "ASACOM" | "SUPPORT_TEACHER",
        studentPublicId,
        learningAttemptId: attemptId,
        supportType,
        intensity,
        ...(duration ? { durationSeconds: Number.parseInt(duration, 10) } : {}),
        csrfToken,
      });
      setAttemptId("");
      events.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  // -- Observation form state --
  const [obsCategory, setObsCategory] = useState<SupportType | "">("");

  async function handleCreateObservation(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await createObservation({
        actorRole: context.role as "ASACOM" | "SUPPORT_TEACHER",
        studentPublicId,
        ...(obsCategory ? { category: obsCategory } : {}),
        csrfToken,
      });
      observations.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSupersede(observationId: string) {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await supersedeObservation({ actorRole: context.role as "ASACOM" | "SUPPORT_TEACHER", observationId, csrfToken });
      observations.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  // -- Proposal form state --
  const [proposalType, setProposalType] = useState<FacilitationProposalType>("FACILITATION");
  const [proposalTargetCategory, setProposalTargetCategory] = useState("");

  async function handleCreateProposal(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await createFacilitationProposal({
        actorRole: context.role as "ASACOM" | "SUPPORT_TEACHER",
        studentPublicId,
        proposalType,
        ...(proposalTargetCategory ? { targetCategory: proposalTargetCategory } : {}),
        csrfToken,
      });
      setProposalTargetCategory("");
      proposals.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw(id: string) {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawFacilitationProposal({ id, csrfToken });
      proposals.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const currentProfile = facilitation.status === "success" ? facilitation.data.filter((e) => e.level === "PROFILE_LEVEL") : [];
  const temporaryFacilitation = facilitation.status === "success" ? facilitation.data.filter((e) => e.level === "SESSION_ONLY") : [];
  const pendingProposals = proposals.status === "success" ? proposals.data.filter((p) => p.status === "SUBMITTED") : [];

  const timeline: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = [];
    if (events.status === "success") {
      for (const ev of events.data) {
        entries.push({
          key: `event-${ev.id}`,
          type: "event",
          occurredAt: ev.occurredAt,
          label: `${t(DASHBOARD_CATALOG_IT_IT, SUPPORT_TYPE_LABEL_KEY[ev.supportType])} (${t(DASHBOARD_CATALOG_IT_IT, INTENSITY_LABEL_KEY[ev.intensity])})`,
          actorRole: ev.actorRole,
        });
      }
    }
    if (observations.status === "success") {
      for (const obs of observations.data) {
        entries.push({
          key: `obs-${obs.id}`,
          type: "observation",
          occurredAt: obs.observedAt,
          label: obs.category ? t(DASHBOARD_CATALOG_IT_IT, SUPPORT_TYPE_LABEL_KEY[obs.category]) : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.timelineTypeObservation"),
          actorRole: obs.actorRole,
          status: obs.historyStatus === "SUPERSEDED" ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationSupersededBadge") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationCurrentBadge"),
        });
      }
    }
    if (proposals.status === "success") {
      for (const p of proposals.data) {
        entries.push({
          key: `proposal-${p.id}`,
          type: "proposal",
          occurredAt: p.createdAt,
          label: `${p.proposalType} — ${p.targetCategory ?? "—"}`,
          status: p.status,
        });
      }
    }
    return entries.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [events, observations, proposals]);

  return (
    <main>
      <p>
        <Link href="/app/support/my-students">{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.backToMyStudents")}</Link>
      </p>
      <h1>
        {t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.title")}: {studentPublicId}
      </h1>
      <p>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.noDiagnosisNotice")}</p>
      {!isAsacom ? (
        <p>
          <Link href={`/app/students/${encodeURIComponent(studentPublicId)}/learning-path`}>{t(DASHBOARD_CATALOG_IT_IT, "app.studentLearningPath.title")}</Link>
        </p>
      ) : null}
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.profileSectionTitle")}</h2>
        {facilitation.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {facilitation.status === "success" && currentProfile.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.profileSectionEmpty")} />
        ) : null}
        {currentProfile.length > 0 ? (
          <Table
            columns={[
              { key: "category", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnCategory"), render: (row) => t(DASHBOARD_CATALOG_IT_IT, CATEGORY_LABEL_KEY[row.category]) },
              { key: "appliedBy", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnAppliedBy"), render: (row) => row.appliedByRole },
            ]}
            rows={currentProfile}
            rowKey={(row) => `${row.category}-${row.updatedAt}`}
          />
        ) : null}
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.temporarySectionTitle")}</h2>
        {facilitation.status === "success" && temporaryFacilitation.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.temporarySectionEmpty")} />
        ) : null}
        {temporaryFacilitation.length > 0 ? (
          <Table
            columns={[
              { key: "category", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnCategory"), render: (row) => t(DASHBOARD_CATALOG_IT_IT, CATEGORY_LABEL_KEY[row.category]) },
              { key: "expiresAt", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnExpiresAt"), render: (row) => (row.expiresAt ? new Date(row.expiresAt).toLocaleTimeString("it-IT") : "—") },
            ]}
            rows={temporaryFacilitation}
            rowKey={(row) => `${row.category}-${row.updatedAt}`}
          />
        ) : null}
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.pendingProposalsSectionTitle")}</h2>
        {proposals.status === "success" && pendingProposals.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.pendingProposalsSectionEmpty")} />
        ) : null}
        {pendingProposals.length > 0 ? (
          <Table
            columns={[
              { key: "type", header: t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnType"), render: (row) => row.proposalType },
              { key: "category", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalTargetCategoryLabel"), render: (row) => row.targetCategory ?? "—" },
              {
                key: "withdraw",
                header: "",
                render: (row) => (
                  <Button variant="secondary" disabled={busy || !csrfToken} onClick={() => void handleWithdraw(row.id)}>
                    {t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.withdrawAction")}
                  </Button>
                ),
              },
            ]}
            rows={pendingProposals}
            rowKey={(row) => row.id}
          />
        ) : null}
      </section>

      {context.role === "SUPPORT_TEACHER" ? (
        <section className="qc-card">
          <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.difficultyTitle")}</h2>
          <form onSubmit={handleDifficultyOverride}>
            <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.difficultyTargetRefLabel")}>
              {(fieldProps) => <input {...fieldProps} type="text" required value={targetRef} onChange={(e) => setTargetRef(e.target.value)} />}
            </FormField>
            <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.difficultyReasonLabel")}>
              {(fieldProps) => <input {...fieldProps} type="text" required value={reason} onChange={(e) => setReason(e.target.value)} />}
            </FormField>
            <Button type="submit" disabled={busy || !csrfToken}>
              {busy ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.difficultySubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.difficultySubmit")}
            </Button>
          </form>
        </section>
      ) : null}

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplyTitle")}</h2>
        <form onSubmit={handleApplyFacilitation}>
          {!isAsacom ? (
            <>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplyCategoryLabel")}>
                {(fieldProps) => (
                  <select {...fieldProps} value={facCategory} onChange={(e) => setFacCategory(e.target.value as SupportProfileCategory)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(DASHBOARD_CATALOG_IT_IT, CATEGORY_LABEL_KEY[c])}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplyLevelLabel")}>
                {(fieldProps) => (
                  <select {...fieldProps} value={facLevel} onChange={(e) => setFacLevel(e.target.value as "SESSION_ONLY" | "PROFILE_LEVEL")}>
                    <option value="SESSION_ONLY">{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplyLevelSessionOnly")}</option>
                    <option value="PROFILE_LEVEL">{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplyLevelProfileLevel")}</option>
                  </select>
                )}
              </FormField>
            </>
          ) : (
            <p>{t(DASHBOARD_CATALOG_IT_IT, CATEGORY_LABEL_KEY.TOOLS)} — SESSION_ONLY</p>
          )}
          <Button type="submit" disabled={busy || !csrfToken}>
            {busy ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplySubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.facilitationApplySubmit")}
          </Button>
        </form>
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormTitle")}</h2>
        <form onSubmit={handleCreateEvent}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormAttemptIdLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" required value={attemptId} onChange={(e) => setAttemptId(e.target.value)} />}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormSupportTypeLabel")}>
            {(fieldProps) => (
              <select {...fieldProps} value={supportType} onChange={(e) => setSupportType(e.target.value as SupportType)}>
                {SUPPORT_TYPES.map((st) => (
                  <option key={st} value={st}>
                    {t(DASHBOARD_CATALOG_IT_IT, SUPPORT_TYPE_LABEL_KEY[st])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormIntensityLabel")}>
            {(fieldProps) => (
              <select {...fieldProps} value={intensity} onChange={(e) => setIntensity(e.target.value as SupportIntensity)}>
                {INTENSITIES.map((i) => (
                  <option key={i} value={i}>
                    {t(DASHBOARD_CATALOG_IT_IT, INTENSITY_LABEL_KEY[i])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormDurationLabel")}>
            {(fieldProps) => <input {...fieldProps} type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={busy || !csrfToken}>
            {busy ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.eventFormSubmit")}
          </Button>
        </form>
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationsTitle")}</h2>
        <form onSubmit={handleCreateObservation}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnCategory")}>
            {(fieldProps) => (
              <select {...fieldProps} value={obsCategory} onChange={(e) => setObsCategory(e.target.value as SupportType | "")}>
                <option value="">—</option>
                {SUPPORT_TYPES.map((st) => (
                  <option key={st} value={st}>
                    {t(DASHBOARD_CATALOG_IT_IT, SUPPORT_TYPE_LABEL_KEY[st])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Button type="submit" disabled={busy || !csrfToken}>
            {busy ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationFormSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationFormSubmit")}
          </Button>
        </form>
        {observations.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {observations.status === "success" && observations.data.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationsEmpty")} />
        ) : null}
        {observations.status === "success" && observations.data.length > 0 ? (
          <Table
            columns={[
              { key: "category", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.columnCategory"), render: (row) => (row.category ? t(DASHBOARD_CATALOG_IT_IT, SUPPORT_TYPE_LABEL_KEY[row.category]) : "—") },
              { key: "observedAt", header: "", render: (row) => new Date(row.observedAt).toLocaleString("it-IT") },
              {
                key: "status",
                header: "",
                render: (row) =>
                  row.historyStatus === "SUPERSEDED"
                    ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationSupersededBadge")
                    : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationCurrentBadge"),
              },
              {
                key: "supersede",
                header: "",
                render: (row) =>
                  row.historyStatus === "CURRENT" && row.actorStaffAccountId === context.staffAccountId ? (
                    <Button variant="secondary" disabled={busy || !csrfToken} onClick={() => void handleSupersede(row.id)}>
                      {t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.observationSupersedeAction")}
                    </Button>
                  ) : null,
              },
            ]}
            rows={observations.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalsTitle")}</h2>
        <form onSubmit={handleCreateProposal}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnType")}>
            {(fieldProps) => (
              <select {...fieldProps} value={proposalType} onChange={(e) => setProposalType(e.target.value as FacilitationProposalType)}>
                <option value="FACILITATION">{t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.typeFacilitation")}</option>
                <option value="DIFFICULTY">{t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.typeDifficulty")}</option>
              </select>
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalTargetCategoryLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" value={proposalTargetCategory} onChange={(e) => setProposalTargetCategory(e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={busy || !csrfToken}>
            {busy ? t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalSubmit")}
          </Button>
        </form>
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.timelineTitle")}</h2>
        {timeline.length === 0 ? <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.timelineEmpty")} /> : null}
        {timeline.length > 0 ? (
          <ul>
            {timeline.map((entry) => (
              <li key={entry.key}>
                <span>{new Date(entry.occurredAt).toLocaleString("it-IT")}</span> — <strong>{entry.label}</strong>
                {entry.actorRole ? ` (${entry.actorRole})` : ""}
                {entry.status ? ` — ${entry.status}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
