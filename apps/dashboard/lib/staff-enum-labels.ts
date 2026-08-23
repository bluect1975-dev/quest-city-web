import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type {
  AttemptRuntimeChannel,
  AttemptState,
  CompletionStatus,
  FacilitationProposalStatus,
  TeacherFeedbackDeliveryStatus,
} from "./staff-api-types";

/**
 * UAT Failure Remediation (`UAT-RC4-TEACHER-STUDENT-DETAIL-ENUM-01`,
 * `-STATUS-I18N-01`, `-TECHNICAL-ENUM-01`): every closed DB enum a staff
 * surface renders gets a human Italian label here — never the raw string
 * — reusing the existing `app.status.*` catalog (already the source for
 * feedback publication/delivery status and roster enrollment status)
 * rather than inventing a second label system.
 */
export function attemptStateLabel(state: AttemptState): string {
  const key = { CREATED: "created", IN_PROGRESS: "inProgress", COMPLETION_SUBMITTED: "completionSubmitted", COMPLETED: "completed", ABANDONED: "abandoned", EXPIRED: "expired" }[state];
  return t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}` as `app.status.${string}`);
}

export function completionStatusLabel(status: CompletionStatus | null): string {
  if (!status) return t(DASHBOARD_CATALOG_IT_IT, "app.status.notApplicable");
  const key = { ACCEPTED_NOT_CONSOLIDATED: "acceptedNotConsolidated", RECONCILIATION_REQUIRED: "reconciliationRequired", CONSOLIDATED: "consolidated" }[status];
  return t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}` as `app.status.${string}`);
}

export function runtimeChannelLabel(channel: AttemptRuntimeChannel): string {
  const key = { WEB: "web", ROBLOX: "roblox", UNKNOWN_LEGACY: "unknownLegacy" }[channel];
  return t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}` as `app.status.${string}`);
}

export function enrollmentStatusLabel(status: string): string {
  const key = { INVITED: "invited", ACTIVE: "active", SUSPENDED: "suspended", LEFT: "left", ARCHIVED: "archived" }[status];
  return key ? t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}` as `app.status.${string}`) : status;
}

export function deliveryStatusLabel(status: TeacherFeedbackDeliveryStatus): string {
  const key = { NOT_APPLICABLE: "notApplicable", PENDING: "pending", DELIVERED: "delivered", READ: "read", FAILED: "failed" }[status];
  return t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}` as `app.status.${string}`);
}

export function facilitationProposalStatusLabel(status: FacilitationProposalStatus): string {
  if (status === "ACCEPTED") return t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalStatusAccepted");
  if (status === "REJECTED") return t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalStatusRejected");
  if (status === "WITHDRAWN") return t(DASHBOARD_CATALOG_IT_IT, "app.status.withdrawn");
  return t(DASHBOARD_CATALOG_IT_IT, "app.status.submitted");
}
