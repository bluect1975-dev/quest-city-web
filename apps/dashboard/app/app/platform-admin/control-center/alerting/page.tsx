"use client";

import { useState } from "react";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { usePlatformAuth } from "../../../../../lib/platform-auth-context";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { generateIdempotencyKey, getAlertConfiguration, sendAlertTest, updateAlertConfiguration } from "../../../../../lib/platform-api-client";
import type { AlertConfiguration, AlertTestResult, OperationalIncidentSeverity, PlatformContext } from "../../../../../lib/platform-api-types";

/**
 * `/app/platform-admin/control-center/alerting` (capability
 * `operations.alerting.view`, manage for save/test, 02_42 v1.1 §30,§33,
 * §54). Never displays the Bot Token -- CONFIGURED/NOT_CONFIGURED plus
 * masked recipient only.
 */
export default function ControlCenterAlertingPage() {
  return <RequirePlatformAuth>{(context) => <AlertingView context={context} />}</RequirePlatformAuth>;
}

function AlertingView({ context }: { context: PlatformContext }) {
  const { csrfToken } = usePlatformAuth();
  const result = useAsyncPlatform<AlertConfiguration>(() => getAlertConfiguration(), []);
  const canManage = context.capabilities.includes("operations.alerting.manage");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AlertTestResult | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [severityThreshold, setSeverityThreshold] = useState<OperationalIncidentSeverity>("SEV-2");
  const [cooldownSeconds, setCooldownSeconds] = useState(900);
  const [formInitialized, setFormInitialized] = useState(false);

  if (result.status === "success" && !formInitialized) {
    setEnabled(result.data.enabled);
    setSeverityThreshold(result.data.severityThreshold);
    setCooldownSeconds(result.data.cooldownSeconds);
    setFormInitialized(true);
  }

  async function handleSave() {
    if (!csrfToken) return;
    setSaving(true);
    try {
      await updateAlertConfiguration({ enabled, severityThreshold, cooldownSeconds, csrfToken, idempotencyKey: generateIdempotencyKey() });
      result.reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!csrfToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const outcome = await sendAlertTest({ csrfToken, idempotencyKey: generateIdempotencyKey() });
      setTestResult(outcome);
    } finally {
      setTesting(false);
    }
  }

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <p>
            <span>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.channelStatus")}: </span>
            <StatusBadge tone={result.data.status === "CONFIGURED" ? "success" : "neutral"}>{result.data.status}</StatusBadge>
          </p>
          {result.data.recipientMasked ? (
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.recipient")}: {result.data.recipientMasked}
            </p>
          ) : null}
          <fieldset disabled={!canManage}>
            <legend>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.configurationLegend")}</legend>
            <label>
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.enabled")}
            </label>
            <label>
              {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.severityThreshold")}
              <select value={severityThreshold} onChange={(event) => setSeverityThreshold(event.target.value as OperationalIncidentSeverity)}>
                <option value="SEV-1">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.severitySev1")}</option>
                <option value="SEV-2">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.severitySev2")}</option>
                <option value="SEV-3">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.severitySev3")}</option>
                <option value="SEV-4">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.severitySev4")}</option>
              </select>
            </label>
            <label>
              {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.cooldownSeconds")}
              <input
                type="number"
                min={60}
                value={cooldownSeconds}
                onChange={(event) => setCooldownSeconds(Number.parseInt(event.target.value, 10) || 60)}
              />
            </label>
          </fieldset>
          {canManage ? (
            <>
              <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.save")}
              </Button>
              <Button variant="secondary" disabled={testing} onClick={() => void handleTest()}>
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.sendTest")}
              </Button>
            </>
          ) : null}
          {testResult ? (
            testResult.deliveryStatus === "SENT" ? (
              <p role="status">
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.testResult")}: <StatusBadge tone="success">{testResult.deliveryStatus}</StatusBadge>
              </p>
            ) : (
              <StatusMessage kind="error">
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.alerting.testResult")}: {testResult.deliveryStatus}
              </StatusMessage>
            )
          ) : null}
        </>
      ) : null}
    </main>
  );
}
