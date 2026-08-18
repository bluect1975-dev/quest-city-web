"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../../lib/staff-auth-context";
import { useAsync } from "../../../../lib/useAsync";
import { staffErrorText } from "../../../../lib/staff-error-text";
import {
  addStudentToRoster,
  archiveClass,
  assignTeacherToClass,
  createGeneralAssignment,
  getClass,
  getClassProgress,
  listClassStudents,
  listStaffMembers,
  regenerateClassAccessCode,
  removeStudentFromRoster,
  renameClass,
  unassignTeacherFromClass,
} from "../../../../lib/staff-api-client";
import type {
  ProgressAggregate,
  RosterMode,
  SchoolClassDetail,
  StaffMember,
  StaffRole,
  StudentRosterEntry,
} from "../../../../lib/staff-api-types";

interface ClassDetailData {
  schoolClass: SchoolClassDetail;
  roster: StudentRosterEntry[];
  progress: ProgressAggregate;
  staffMembers: StaffMember[];
}

/**
 * `/app/classes/{classId}` (02_35 §5-6, v1.2 §11bis.6-9, v1.4 §11ter.4-5).
 * SCHOOL_ADMIN and INDEPENDENT_EDUCATOR (tenant-wide `class.manage`) can
 * rename/archive/regenerate the access code; teacher assignment
 * (`class.teacher.assign`) is SCHOOL_ADMIN-only -- INDEPENDENT_EDUCATOR
 * has no co-educator in this tranche (§11ter.9). All staff roles with
 * scope on this class can manage roster and assign content.
 */
export default function StaffClassDetailPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  return <RequireStaffAuth>{(context) => <ClassDetailView classId={classId} role={context.role} />}</RequireStaffAuth>;
}

function ClassDetailView({ classId, role }: { classId: string; role: StaffRole }) {
  const { csrfToken } = useStaffAuth();
  const canManageClass = role === "SCHOOL_ADMIN" || role === "INDEPENDENT_EDUCATOR";
  const canManageTeachers = role === "SCHOOL_ADMIN";

  const result = useAsync<ClassDetailData>(async () => {
    const [schoolClass, roster, progress, staffMembers] = await Promise.all([
      getClass(classId),
      listClassStudents(classId),
      getClassProgress(classId),
      canManageTeachers ? listStaffMembers() : Promise.resolve<StaffMember[]>([]),
    ]);
    return { schoolClass, roster, progress, staffMembers };
  }, [classId, canManageTeachers]);

  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regeneratedAccessCode, setRegeneratedAccessCode] = useState<string | null>(null);

  const [assignTeacherId, setAssignTeacherId] = useState("");
  const [teacherBusy, setTeacherBusy] = useState<string | null>(null);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  const [rosterMode, setRosterMode] = useState<RosterMode>("NEW");
  const [studentPublicId, setStudentPublicId] = useState("");
  const [accessAlias, setAccessAlias] = useState("");
  const [pin, setPin] = useState("");
  const [addStudentBusy, setAddStudentBusy] = useState(false);
  const [addStudentError, setAddStudentError] = useState<string | null>(null);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const [removeStudentBusy, setRemoveStudentBusy] = useState<string | null>(null);
  const [removeStudentError, setRemoveStudentError] = useState<string | null>(null);

  const [contentBundleId, setContentBundleId] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      await renameClass({ classId, name: renameValue, csrfToken });
      setRenameValue("");
      result.reload();
    } catch (error) {
      setRenameError(staffErrorText(error));
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleArchive() {
    if (!csrfToken || !window.confirm(t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.archiveConfirm"))) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await archiveClass({ classId, csrfToken });
      result.reload();
    } catch (error) {
      setArchiveError(staffErrorText(error));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleRegenerateAccessCode() {
    if (!csrfToken || !window.confirm(t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.regenerateAccessCodeConfirm"))) return;
    setRegenerateBusy(true);
    setRegenerateError(null);
    setRegeneratedAccessCode(null);
    try {
      const regenerated = await regenerateClassAccessCode({ classId, csrfToken });
      setRegeneratedAccessCode(regenerated.accessCode);
    } catch (error) {
      setRegenerateError(staffErrorText(error));
    } finally {
      setRegenerateBusy(false);
    }
  }

  async function handleAssignTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !assignTeacherId) return;
    setTeacherBusy(assignTeacherId);
    setTeacherError(null);
    try {
      await assignTeacherToClass({ classId, staffTenantMembershipId: assignTeacherId, csrfToken });
      setAssignTeacherId("");
      result.reload();
    } catch (error) {
      setTeacherError(staffErrorText(error));
    } finally {
      setTeacherBusy(null);
    }
  }

  async function handleUnassignTeacher(staffTenantMembershipId: string) {
    if (!csrfToken) return;
    setTeacherBusy(staffTenantMembershipId);
    setTeacherError(null);
    try {
      await unassignTeacherFromClass({ classId, staffTenantMembershipId, csrfToken });
      result.reload();
    } catch (error) {
      setTeacherError(staffErrorText(error));
    } finally {
      setTeacherBusy(null);
    }
  }

  async function handleAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setAddStudentBusy(true);
    setAddStudentError(null);
    setGeneratedPin(null);
    try {
      const member = await addStudentToRoster({
        classId,
        mode: rosterMode,
        studentPublicId: rosterMode === "EXISTING" ? studentPublicId : undefined,
        accessAlias,
        pin: pin || undefined,
        csrfToken,
      });
      setStudentPublicId("");
      setAccessAlias("");
      setPin("");
      if (member.pin) setGeneratedPin(member.pin);
      result.reload();
    } catch (error) {
      setAddStudentError(staffErrorText(error));
    } finally {
      setAddStudentBusy(false);
    }
  }

  async function handleRemoveStudent(studentProfileId: string) {
    if (!csrfToken || !window.confirm(t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.removeStudentConfirm"))) return;
    setRemoveStudentBusy(studentProfileId);
    setRemoveStudentError(null);
    try {
      await removeStudentFromRoster({ classId, studentProfileId, csrfToken });
      result.reload();
    } catch (error) {
      setRemoveStudentError(staffErrorText(error));
    } finally {
      setRemoveStudentBusy(null);
    }
  }

  async function handleAssignContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setAssignBusy(true);
    setAssignError(null);
    setAssignSuccess(false);
    try {
      await createGeneralAssignment({
        classId,
        contentBundleId,
        title: assignmentTitle,
        allowedRuntimeChannels: ["WEB"],
        csrfToken,
      });
      setContentBundleId("");
      setAssignmentTitle("");
      setAssignSuccess(true);
    } catch (error) {
      setAssignError(staffErrorText(error));
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <main>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <h1>
            {result.data.schoolClass.name}{" "}
            {result.data.schoolClass.status === "ARCHIVED" ? (
              <StatusBadge tone="neutral">{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.archivedBadge")}</StatusBadge>
            ) : null}
          </h1>

          <p>
            <Link href={`/app/classes/${encodeURIComponent(classId)}/learning-path`}>{t(DASHBOARD_CATALOG_IT_IT, "app.classLearningPath.title")}</Link>
          </p>

          {canManageClass ? (
            <section className="qc-card">
              <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.renameTitle")}</h2>
              <form onSubmit={handleRename}>
                <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.renameLabel")}>
                  {(fieldProps) => (
                    <input {...fieldProps} type="text" required value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                  )}
                </FormField>
                <Button type="submit" disabled={renameBusy || !csrfToken}>
                  {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.renameSubmit")}
                </Button>
              </form>
              {renameError ? <StatusMessage kind="error">{renameError}</StatusMessage> : null}

              {result.data.schoolClass.status === "ACTIVE" ? (
                <Button variant="secondary" disabled={archiveBusy || !csrfToken} onClick={() => void handleArchive()}>
                  {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.archiveAction")}
                </Button>
              ) : null}
              {archiveError ? <StatusMessage kind="error">{archiveError}</StatusMessage> : null}

              {result.data.schoolClass.status === "ACTIVE" ? (
                <Button variant="secondary" disabled={regenerateBusy || !csrfToken} onClick={() => void handleRegenerateAccessCode()}>
                  {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.regenerateAccessCodeAction")}
                </Button>
              ) : null}
              {regenerateError ? <StatusMessage kind="error">{regenerateError}</StatusMessage> : null}
              {regeneratedAccessCode ? (
                <p role="status">
                  {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.regenerateAccessCodeResult")} <code>{regeneratedAccessCode}</code>
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.progressTitle")}</h2>
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.totalAttemptsLabel")}: {result.data.progress.totalAttempts}
            </p>
          </section>

          {canManageTeachers ? (
            <section className="qc-card">
              <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.teachersTitle")}</h2>
              {(() => {
                const assigned = result.data.staffMembers.filter(
                  (m) => m.role === "TEACHER" && m.classScope !== null && m.classScope.includes(classId),
                );
                const assignable = result.data.staffMembers.filter(
                  (m) => m.role === "TEACHER" && m.status === "ACTIVE" && !(m.classScope !== null && m.classScope.includes(classId)),
                );
                return (
                  <>
                    {assigned.length === 0 ? (
                      <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.emptyTeachers")} />
                    ) : (
                      <Table
                        columns={[
                          { key: "email", header: t(DASHBOARD_CATALOG_IT_IT, "app.staff.columnEmail"), render: (row) => row.email },
                          {
                            key: "unassign",
                            header: "",
                            render: (row) => (
                              <Button
                                variant="secondary"
                                disabled={teacherBusy === row.staffTenantMembershipId || !csrfToken}
                                onClick={() => void handleUnassignTeacher(row.staffTenantMembershipId)}
                              >
                                {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.unassignTeacherAction")}
                              </Button>
                            ),
                          },
                        ]}
                        rows={assigned}
                        rowKey={(row) => row.staffTenantMembershipId}
                      />
                    )}
                    <form onSubmit={handleAssignTeacher}>
                      <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignTeacherLabel")}>
                        {(fieldProps) => (
                          <select
                            {...fieldProps}
                            required
                            value={assignTeacherId}
                            onChange={(e) => setAssignTeacherId(e.target.value)}
                          >
                            <option value="" disabled>
                              {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignTeacherLabel")}
                            </option>
                            {assignable.map((member) => (
                              <option key={member.staffTenantMembershipId} value={member.staffTenantMembershipId}>
                                {member.email}
                              </option>
                            ))}
                          </select>
                        )}
                      </FormField>
                      <Button type="submit" disabled={teacherBusy !== null || !csrfToken || !assignTeacherId}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignTeacherSubmit")}
                      </Button>
                    </form>
                    {teacherError ? <StatusMessage kind="error">{teacherError}</StatusMessage> : null}
                  </>
                );
              })()}
            </section>
          ) : null}

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.rosterTitle")}</h2>
            {result.data.roster.length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.emptyRoster")} />
            ) : (
              <Table
                columns={[
                  { key: "alias", header: t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.columnAlias"), render: (row) => row.accessAlias },
                  {
                    key: "status",
                    header: t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.columnEnrollmentStatus"),
                    render: (row) => row.enrollmentStatus,
                  },
                  {
                    key: "open",
                    header: "",
                    render: (row) => (
                      <Link href={`/app/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(row.studentProfileId)}`}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.openStudent")}
                      </Link>
                    ),
                  },
                  {
                    key: "remove",
                    header: "",
                    render: (row) =>
                      row.enrollmentStatus === "ACTIVE" ? (
                        <Button
                          variant="secondary"
                          disabled={removeStudentBusy === row.studentProfileId || !csrfToken}
                          onClick={() => void handleRemoveStudent(row.studentProfileId)}
                        >
                          {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.removeStudentAction")}
                        </Button>
                      ) : null,
                  },
                ]}
                rows={result.data.roster}
                rowKey={(row) => row.studentProfileId}
              />
            )}
            {removeStudentError ? <StatusMessage kind="error">{removeStudentError}</StatusMessage> : null}

            <h3>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentTitle")}</h3>
            <form onSubmit={handleAddStudent}>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentModeLabel")}>
                {(fieldProps) => (
                  <select {...fieldProps} value={rosterMode} onChange={(e) => setRosterMode(e.target.value as RosterMode)}>
                    <option value="NEW">{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentModeNew")}</option>
                    <option value="EXISTING">{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentModeExisting")}</option>
                  </select>
                )}
              </FormField>
              {rosterMode === "EXISTING" ? (
                <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentPublicIdLabel")}>
                  {(fieldProps) => (
                    <input
                      {...fieldProps}
                      type="text"
                      required
                      value={studentPublicId}
                      onChange={(e) => setStudentPublicId(e.target.value)}
                    />
                  )}
                </FormField>
              ) : null}
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentAliasLabel")}>
                {(fieldProps) => (
                  <input {...fieldProps} type="text" required value={accessAlias} onChange={(e) => setAccessAlias(e.target.value)} />
                )}
              </FormField>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentPinLabel")}>
                {(fieldProps) => <input {...fieldProps} type="text" value={pin} onChange={(e) => setPin(e.target.value)} />}
              </FormField>
              <Button type="submit" disabled={addStudentBusy || !csrfToken}>
                {addStudentBusy
                  ? t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentSubmitting")
                  : t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentSubmit")}
              </Button>
            </form>
            {addStudentError ? <StatusMessage kind="error">{addStudentError}</StatusMessage> : null}
            {generatedPin ? (
              <p role="status">
                {t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.addStudentPinResult")} <code>{generatedPin}</code>
              </p>
            ) : null}
          </section>

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentTitle")}</h2>
            <form onSubmit={handleAssignContent}>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentBundleIdLabel")}>
                {(fieldProps) => (
                  <input
                    {...fieldProps}
                    type="text"
                    required
                    value={contentBundleId}
                    onChange={(e) => setContentBundleId(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentTitleLabel")}>
                {(fieldProps) => (
                  <input
                    {...fieldProps}
                    type="text"
                    required
                    value={assignmentTitle}
                    onChange={(e) => setAssignmentTitle(e.target.value)}
                  />
                )}
              </FormField>
              <Button type="submit" disabled={assignBusy || !csrfToken}>
                {assignBusy
                  ? t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentSubmitting")
                  : t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentSubmit")}
              </Button>
            </form>
            {assignError ? <StatusMessage kind="error">{assignError}</StatusMessage> : null}
            {assignSuccess ? <p role="status">{t(DASHBOARD_CATALOG_IT_IT, "app.classDetail.assignContentSuccess")}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
