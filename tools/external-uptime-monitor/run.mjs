#!/usr/bin/env -S npx tsx
// Quest City Web -- External Uptime Monitor (02_42 v1.2 PARTE U §52-73,
// AGENTS.md §4.31). CLI dispatcher invoked once per workflow step by
// .github/workflows/external-uptime-monitor.yml, one subcommand per step so
// each meaningful transition becomes a distinctly-named, independently
// queryable GitHub Actions step (see cooldown.mjs's header comment for why
// this is the state-storage mechanism, not a database).
//
// Subcommands: probe | history | level1-alert | level1-recovery |
// level1-backfill | level2-submit
//
// Every subcommand reads its own inputs from process.env (workflow step
// `env:` blocks) and writes its outputs to $GITHUB_OUTPUT. Never logs a
// secret value (TELEGRAM_BOT_TOKEN, EXTERNAL_MONITOR_HMAC_SECRET,
// GITHUB_TOKEN) -- only derived, non-sensitive summaries.

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runProbe } from "./probe.mjs";
import { decodeHmacSecret } from "./hmac.mjs";
import { buildReportBody, submitLevel2Report } from "./level2-submit.mjs";
import { buildAlertMessage, buildRecoveryMessage, sendTelegramMessage } from "./level1-telegram.mjs";
import { getMonitorHistory, isInCooldown, level1DetectedStepName } from "./cooldown.mjs";

function writeOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  const line = `${key}<<__EOM__\n${value}\n__EOM__\n`;
  if (outputFile) {
    appendFileSync(outputFile, line);
  } else {
    // Local/manual invocation (no GITHUB_OUTPUT) -- print instead of failing, so this script stays runnable outside CI for debugging.
    console.log(`[output] ${key}=${value}`);
  }
}

function loadProbeConfig() {
  const host = process.env.EXTERNAL_MONITOR_TARGET_HOST;
  if (!host) throw new Error("EXTERNAL_MONITOR_TARGET_HOST is required.");
  return {
    host,
    tlsPort: Number(process.env.EXTERNAL_MONITOR_TARGET_TLS_PORT ?? "443"),
    healthUrl: process.env.EXTERNAL_MONITOR_HEALTH_URL ?? `https://${host}/api/health/ready`,
    timeoutMs: Number(process.env.EXTERNAL_MONITOR_TIMEOUT_MS ?? "10000"),
    tlsExpiryWarningDays: Number(process.env.EXTERNAL_MONITOR_TLS_EXPIRY_WARNING_DAYS ?? "14"),
    httpLatencyThresholdMs: Number(process.env.EXTERNAL_MONITOR_HTTP_LATENCY_THRESHOLD_MS ?? "3000"),
  };
}

function loadGithubContext() {
  const repository = process.env.GITHUB_REPOSITORY; // "owner/repo"
  const token = process.env.GITHUB_TOKEN;
  const runId = process.env.GITHUB_RUN_ID;
  if (!repository || !token || !runId) {
    throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_RUN_ID are required (provided automatically by GitHub Actions).");
  }
  const [owner, repo] = repository.split("/");
  return {
    owner,
    repo,
    token,
    currentRunId: Number(runId),
    workflowFileName: process.env.EXTERNAL_MONITOR_WORKFLOW_FILE ?? "external-uptime-monitor.yml",
  };
}

function environmentName() {
  const env = process.env.EXTERNAL_MONITOR_ENVIRONMENT ?? "PRODUCTION";
  if (env !== "STAGING" && env !== "PRODUCTION") {
    throw new Error(`EXTERNAL_MONITOR_ENVIRONMENT must be STAGING or PRODUCTION, got: ${env}`);
  }
  return env;
}

function monitorId() {
  return process.env.EXTERNAL_MONITOR_ID ?? "github-actions:questcity-external-monitor";
}

async function cmdProbe() {
  const config = loadProbeConfig();
  const result = await runProbe(config);
  writeOutput("reachable", String(result.reachable));
  writeOutput("condition_type", result.level1?.conditionType ?? "");
  writeOutput("result", JSON.stringify(result));
  console.log(`Probe complete: reachable=${result.reachable}${result.level1 ? `, level1=${result.level1.conditionType}` : ""}${result.level2Conditions.length ? `, level2Conditions=${result.level2Conditions.map((c) => c.conditionType).join(",")}` : ""}`);
}

async function cmdHistory() {
  const gh = loadGithubContext();
  const cooldownMs = Number(process.env.EXTERNAL_MONITOR_COOLDOWN_MINUTES ?? "15") * 60_000;
  const history = await getMonitorHistory({ ...gh, maxRunsToScan: Number(process.env.EXTERNAL_MONITOR_MAX_RUNS_TO_SCAN ?? "20") });
  const inCooldown = isInCooldown(history.lastAlertSentAt, cooldownMs);
  writeOutput("in_cooldown", String(inCooldown));
  writeOutput("was_level1_active", String(history.lastRunLevel1Active));
  writeOutput("outage_started_at", history.outageStartedAt ?? "");
  writeOutput("last_condition_type", history.lastConditionType ?? "");
  console.log(`History: lastAlertSentAt=${history.lastAlertSentAt ?? "(none)"}, inCooldown=${inCooldown}, wasLevel1Active=${history.lastRunLevel1Active}, outageStartedAt=${history.outageStartedAt ?? "(n/a)"}`);
}

function conditionFromType(conditionType) {
  const SERVICE_BY_CONDITION = { VPS_UNREACHABLE: "HOST", REVERSE_PROXY_UNREACHABLE: "REVERSE_PROXY", TLS_HANDSHAKE_FAILURE: "TLS" };
  const service = SERVICE_BY_CONDITION[conditionType];
  if (!service) throw new Error(`${conditionType} is not a recognized Level 1 conditionType.`);
  // summaryCode/evidence are only consumed by buildReportBody (the
  // recovery/backfill Level 2 submit path, 02_42 §56) -- buildAlertMessage/
  // buildRecoveryMessage only read service/conditionType and ignore the
  // rest, so it is safe to always include them here rather than having two
  // separate condition shapes. THRESHOLD_RECOVERED is the canonical
  // summaryCode for a RECOVERED-state report regardless of which Level 1
  // condition originally triggered (02_42 §57: "quest'ultimo per state =
  // RECOVERED").
  return {
    service,
    conditionType,
    summaryCode: "THRESHOLD_RECOVERED",
    evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 0 },
  };
}

async function cmdLevel1Alert() {
  const resultJson = process.env.RESULT_JSON;
  if (!resultJson) throw new Error("RESULT_JSON is required (the probe step's output).");
  const probeResult = JSON.parse(resultJson);
  if (!probeResult.level1) throw new Error("level1-alert invoked but the probe result has no Level 1 condition.");

  const nowIso = new Date().toISOString();
  const message = buildAlertMessage({ environment: environmentName(), condition: probeResult.level1, detectedAt: nowIso });
  const result = await sendTelegramMessage({ botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, text: message });
  if (!result.ok) {
    // A non-success conclusion on this step is itself the durable signal
    // cooldown.mjs reads back on a future run -- failing loudly here is
    // correct, not merely cosmetic: a swallowed failure would make a
    // future run believe an alert was sent when it was not.
    throw new Error(`Level 1 direct alert send failed: ${result.error}`);
  }
  console.log("Level 1 direct alert sent.");
}

async function cmdLevel1Recovery() {
  const lastConditionType = process.env.LAST_CONDITION_TYPE;
  if (!lastConditionType) throw new Error("LAST_CONDITION_TYPE is required (the history step's output).");
  const condition = conditionFromType(lastConditionType);

  const nowIso = new Date().toISOString();
  const message = buildRecoveryMessage({ environment: environmentName(), condition, recoveredAt: nowIso });
  const result = await sendTelegramMessage({ botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, text: message });
  if (!result.ok) {
    throw new Error(`Level 1 direct recovery send failed: ${result.error}`);
  }
  writeOutput("recovered_at", nowIso);
  console.log("Level 1 direct recovery sent.");
}

async function cmdLevel1Backfill() {
  const outageStartedAt = process.env.OUTAGE_STARTED_AT;
  const lastConditionType = process.env.LAST_CONDITION_TYPE;
  const recoveredAt = process.env.RECOVERED_AT;
  if (!outageStartedAt || !lastConditionType || !recoveredAt) {
    throw new Error("OUTAGE_STARTED_AT, LAST_CONDITION_TYPE, and RECOVERED_AT are all required for a backfill.");
  }
  const condition = conditionFromType(lastConditionType);
  const secretBytes = decodeHmacSecret(process.env.EXTERNAL_MONITOR_HMAC_SECRET);
  const keyId = process.env.EXTERNAL_MONITOR_HMAC_KEY_ID;
  if (!keyId) throw new Error("EXTERNAL_MONITOR_HMAC_KEY_ID is required.");

  const body = buildReportBody({
    monitorId: monitorId(),
    observationId: randomUUID(),
    observedAt: recoveredAt,
    environment: environmentName(),
    condition,
    state: "RECOVERED",
    backfill: true,
    detectedAt: outageStartedAt,
    resolvedAt: recoveredAt,
  });
  const result = await submitLevel2Report({ apiBaseUrl: requireApiBaseUrl(), secretBytes, keyId, body });
  if (!result.ok) {
    throw new Error(`Level 1 backfill submit failed: HTTP ${result.status ?? "(network)"} ${result.error ?? ""}`);
  }
  console.log(`Level 1 backfill submitted: incidentPublicId=${result.body?.data?.incidentPublicId ?? "(unknown)"}, deduped=${result.body?.data?.deduped ?? "?"}.`);
}

function requireApiBaseUrl() {
  const url = process.env.EXTERNAL_MONITOR_API_BASE_URL;
  if (!url) throw new Error("EXTERNAL_MONITOR_API_BASE_URL is required.");
  return url;
}

async function cmdLevel2Submit() {
  const resultJson = process.env.RESULT_JSON;
  if (!resultJson) throw new Error("RESULT_JSON is required (the probe step's output).");
  const probeResult = JSON.parse(resultJson);
  if (probeResult.level2Conditions.length === 0) {
    console.log("No Level 2 degraded conditions detected -- nothing to submit.");
    return;
  }

  const secretBytes = decodeHmacSecret(process.env.EXTERNAL_MONITOR_HMAC_SECRET);
  const keyId = process.env.EXTERNAL_MONITOR_HMAC_KEY_ID;
  if (!keyId) throw new Error("EXTERNAL_MONITOR_HMAC_KEY_ID is required.");
  const env = environmentName();
  const observedAt = new Date().toISOString();
  const apiBaseUrl = requireApiBaseUrl();

  let anyFailed = false;
  for (const condition of probeResult.level2Conditions) {
    const body = buildReportBody({ monitorId: monitorId(), observationId: randomUUID(), observedAt, environment: env, condition, state: "DETECTED" });
    const result = await submitLevel2Report({ apiBaseUrl, secretBytes, keyId, body });
    if (!result.ok) {
      anyFailed = true;
      console.error(`Level 2 submit failed for ${condition.conditionType}: HTTP ${result.status ?? "(network)"} ${result.error ?? ""}`);
    } else {
      console.log(`Level 2 report submitted for ${condition.conditionType}: incidentPublicId=${result.body?.data?.incidentPublicId ?? "(unknown)"}, deduped=${result.body?.data?.deduped ?? "?"}.`);
    }
  }
  if (anyFailed) {
    throw new Error("At least one Level 2 report submission failed -- see log above.");
  }
}

const COMMANDS = {
  probe: cmdProbe,
  history: cmdHistory,
  "level1-alert": cmdLevel1Alert,
  "level1-recovery": cmdLevel1Recovery,
  "level1-backfill": cmdLevel1Backfill,
  "level2-submit": cmdLevel2Submit,
};

export async function main(argv = process.argv) {
  const [, , command] = argv;
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command ?? "(none)"}. Expected one of: ${Object.keys(COMMANDS).join(", ")}`);
  }
  await handler();
}

// Cross-platform entrypoint check -- comparing import.meta.url against a
// raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run
// (feedback_windows_node_script_gotchas item 1). This also means importing
// this module from a test file never triggers a real CLI invocation.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
