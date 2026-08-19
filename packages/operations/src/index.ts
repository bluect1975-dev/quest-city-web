export { derivePresenceState, DEFAULT_PRESENCE_THRESHOLDS, type PresenceState, type PresenceThresholds } from "./presence";
export { aggregatePlatformHealth, CRITICAL_SERVICES, type CriticalService, type ServiceHealthInput } from "./health";
export {
  SEVERITY_ORDER,
  meetsSeverityThreshold,
  severityForCondition,
  type IncidentConditionType,
} from "./severity";

export {
  OperationalMetricSampleRepository,
  type MetricSource,
  type MetricSample,
  type MetricSampleStatus,
} from "./repository/operational-metric-sample-repository";
export {
  ServiceHealthStateRepository,
  type ServiceHealthState,
  type ServiceHealthEntry,
} from "./repository/service-health-state-repository";
export {
  OperationalIncidentRepository,
  buildIncidentDedupKey,
  type OperationalIncident,
  type OperationalIncidentSeverity,
  type OperationalIncidentStatus,
} from "./repository/operational-incident-repository";
export {
  OperationalIncidentEventRepository,
  type OperationalIncidentEvent,
  type OperationalIncidentEventType,
} from "./repository/operational-incident-event-repository";
export {
  AlertConfigurationRepository,
  type AlertConfiguration,
  type AlertChannel,
} from "./repository/alert-configuration-repository";
export {
  AlertDeliveryRepository,
  type AlertDelivery,
  type AlertDeliveryKind,
  type AlertDeliveryStatus,
} from "./repository/alert-delivery-repository";
export { UserPresenceRepository, type PresenceActorType, type UserPresenceRow } from "./repository/user-presence-repository";
export {
  OperationsCountersRepository,
  type TenantCounts,
  type StaffRoleCount,
  type StudentCounts,
} from "./repository/operations-counters-repository";

export {
  LocalMockAlertChannelAdapter,
  TelegramAlertChannelAdapter,
  type AlertChannelAdapter,
  type OperationalAlertPayload,
  type OperationalRecoveryPayload,
  type AlertDeliveryResult,
  type TelegramAdapterConfig,
} from "./alerting/alert-channel-adapter";

export { PresenceService, DEFAULT_COALESCE_WINDOW_MS, type PresenceCounts } from "./services/presence-service";
export { IncidentService, type RecordConditionInput, type RecordConditionResult } from "./services/incident-service";
export { AlertService, type MaskedAlertConfiguration } from "./services/alert-service";
export { HealthProbeService } from "./services/health-probe-service";
export { OverviewService } from "./services/overview-service";

export { collectHostMetrics, collectCpuLoad, collectMemoryUsage, collectDiskUsage, type HostMetricSample } from "./collectors/local-metric-collector";

// Tranche E2 out-of-band external monitoring, Level 2 (02_42 v1.2 PARTE U §52-73).
export {
  decodeExternalMonitorHmacSecret,
  ExternalMonitorHmacSecretError,
  EXTERNAL_MONITOR_HMAC_SECRET_MIN_BYTES,
  sha256Hex,
  buildCanonicalString,
  computeSignatureHex,
  signaturesMatch,
} from "./external-monitor/hmac";
export {
  severityForExternalMonitorCondition,
  defaultServiceForExternalMonitorCondition,
  EXTERNAL_MONITOR_SOURCE,
  type ExternalMonitorConditionType,
  type ExternalMonitorService,
  type ExternalMonitorState,
  type ExternalMonitorSummaryCode,
} from "./external-monitor/condition-mapping";
export {
  ExternalMonitorKeyMetadataRepository,
  type ExternalMonitorKeyMetadata,
  type ExternalMonitorKeyStatus,
} from "./external-monitor/repository/external-monitor-key-metadata-repository";
export { ExternalMonitorNonceRepository } from "./external-monitor/repository/external-monitor-nonce-repository";
export {
  ExternalMonitorAuthService,
  ExternalMonitorAuthError,
  type ExternalMonitorAuthFailureReason,
  type VerifyExternalMonitorRequestInput,
  type VerifiedExternalMonitorRequest,
} from "./external-monitor/services/external-monitor-auth-service";
export {
  ExternalMonitorReportService,
  type ExternalMonitorReportRequestBody,
  type ExternalMonitorReportResponseData,
  type ExternalMonitorEvidence,
} from "./external-monitor/services/external-monitor-report-service";
