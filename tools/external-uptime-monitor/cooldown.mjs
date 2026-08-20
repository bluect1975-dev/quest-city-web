// Level 1 anti-storm/cooldown and outage-window reconstruction, deduced
// entirely from the GitHub Actions run history of THIS workflow (02_42
// v1.2 PARTE U §61) -- no external database, no writable repository
// variable, no second secret. Uses the default read-only `GITHUB_TOKEN`
// (no additional secret needed) against the Actions REST API.
//
// The signal available cross-run via the REST API is coarse but sufficient:
// a step's NAME and its `conclusion` (success/skipped/failure), and the
// run's timestamp -- not arbitrary output VALUES (GitHub does not expose
// step output values through the REST API once a run has completed, only
// within the SAME run to later steps). So the workflow marks meaningful
// transitions as distinctly-named, conditionally-executed steps -- their
// mere success/skipped conclusion IS the durable state this module reads
// back. The "Level 1 condition detected" step's NAME is itself templated
// per-run with the specific conditionType (GitHub Actions step `name:`
// supports `${{ steps.<id>.outputs.<x> }}` expressions, evaluated at run
// time) so a LATER run can recover which exact condition (VPS_UNREACHABLE /
// REVERSE_PROXY_UNREACHABLE / TLS_HANDSHAKE_FAILURE) was active, needed to
// backfill the correct incident dedup key (`type, service, source`, 02_42
// §59.C) -- reading it back from a step's mere boolean conclusion alone
// would lose that information.

export const STEP_NAME_LEVEL1_DETECTED_PREFIX = "Level 1 condition detected: ";
export const STEP_NAME_LEVEL1_ALERT_SENT = "Level 1 direct alert sent";

const GITHUB_API_BASE = "https://api.github.com";

/** Builds the exact, templated step name a workflow run uses to record which condition was active. */
export function level1DetectedStepName(conditionType) {
  return `${STEP_NAME_LEVEL1_DETECTED_PREFIX}${conditionType}`;
}

/** Lists recent completed runs of one workflow file, newest first. */
export async function fetchRecentRuns({ owner, repo, workflowFileName, token, perPage = 20 }, deps = {}) {
  const { fetchImpl = fetch } = deps;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowFileName)}/runs?status=completed&per_page=${perPage}`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions API returned HTTP ${response.status} listing workflow runs.`);
  }
  const json = await response.json();
  return (json.workflow_runs ?? []).map((run) => ({ id: run.id, createdAt: run.created_at, updatedAt: run.updated_at }));
}

/** Step-level conclusions for one run's (single) job, keyed by the step's (possibly templated) display name. */
export async function fetchRunStepConclusions({ owner, repo, runId, token }, deps = {}) {
  const { fetchImpl = fetch } = deps;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions API returned HTTP ${response.status} listing run jobs.`);
  }
  const json = await response.json();
  /** @type {Record<string, string>} step name -> conclusion */
  const byName = {};
  for (const job of json.jobs ?? []) {
    for (const step of job.steps ?? []) {
      byName[step.name] = step.conclusion;
    }
  }
  return byName;
}

function findLevel1DetectedConditionType(stepConclusions) {
  for (const [name, conclusion] of Object.entries(stepConclusions)) {
    if (conclusion === "success" && name.startsWith(STEP_NAME_LEVEL1_DETECTED_PREFIX)) {
      return name.slice(STEP_NAME_LEVEL1_DETECTED_PREFIX.length);
    }
  }
  return null;
}

/**
 * Scans recent run history to answer everything the anti-storm/recovery
 * decision needs: was the LAST run an active Level 1 outage (and which
 * conditionType); when did the (possibly still-ongoing) outage streak
 * begin (for backfill's `detectedAt`, and the conditionType to backfill
 * with); when did a Level 1 alert last actually SEND (for the cooldown
 * check). Stops scanning as soon as both answers are known or
 * `maxRunsToScan` is exhausted (bounded work per invocation, never
 * unbounded API usage).
 */
export async function getMonitorHistory({ owner, repo, workflowFileName, token, maxRunsToScan = 20, currentRunId }, deps = {}) {
  const { fetchRecentRunsImpl = fetchRecentRuns, fetchRunStepConclusionsImpl = fetchRunStepConclusions } = deps;

  const runs = (await fetchRecentRunsImpl({ owner, repo, workflowFileName, token, perPage: maxRunsToScan }, deps))
    .filter((run) => run.id !== currentRunId)
    .slice(0, maxRunsToScan);

  let lastAlertSentAt = null;
  let lastRunLevel1Active = false;
  let outageStartedAt = null;
  let lastConditionType = null;
  let scanningOutageStreak = true;
  let isFirst = true;

  for (const run of runs) {
    const steps = await fetchRunStepConclusionsImpl({ owner, repo, runId: run.id, token }, deps);
    const conditionType = findLevel1DetectedConditionType(steps);
    const wasActive = conditionType !== null;
    const alertSent = steps[STEP_NAME_LEVEL1_ALERT_SENT] === "success";

    if (lastAlertSentAt === null && alertSent) {
      lastAlertSentAt = run.updatedAt;
    }
    if (isFirst) {
      lastRunLevel1Active = wasActive;
      isFirst = false;
    }
    if (scanningOutageStreak) {
      if (wasActive) {
        outageStartedAt = run.createdAt; // keep extending backward through the streak
        lastConditionType = conditionType; // the OLDEST run in the streak wins (overwritten each iteration going backward)
      } else {
        scanningOutageStreak = false; // streak boundary found
      }
    }
    if (lastAlertSentAt !== null && !scanningOutageStreak) break; // both answers found, stop scanning
  }

  return { lastAlertSentAt, lastRunLevel1Active, outageStartedAt, lastConditionType };
}

/** Pure function: is `lastAlertSentAt` within the cooldown window relative to `now`? */
export function isInCooldown(lastAlertSentAt, cooldownMs, now = new Date()) {
  if (!lastAlertSentAt) return false;
  const elapsedMs = now.getTime() - new Date(lastAlertSentAt).getTime();
  return elapsedMs >= 0 && elapsedMs < cooldownMs;
}
