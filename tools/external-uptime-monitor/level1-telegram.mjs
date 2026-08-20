// Level 1 direct Telegram fallback (02_42 v1.2 PARTE U §61) -- used ONLY
// when the VPS/API is fully unreachable and the Level 2 endpoint therefore
// cannot be called. Bypasses the Control Center entirely. Template is
// STATIC and bounded: no free text, no PII, no stack trace, no secret --
// exactly the six/seven labeled fields §61 specifies, nothing else is ever
// interpolated into the message.

const PROBLEM_TEXT = {
  VPS_UNREACHABLE: "VPS/API unreachable from external monitor",
  REVERSE_PROXY_UNREACHABLE: "Reverse proxy unreachable from external monitor",
  TLS_HANDSHAKE_FAILURE: "TLS handshake failed from external monitor",
};

/** Only these three conditionTypes can ever reach Level 1 (02_42 §57) -- every other value is a Level 2 concern. */
export const LEVEL1_CONDITION_TYPES = new Set(Object.keys(PROBLEM_TEXT));

function problemText(conditionType) {
  const text = PROBLEM_TEXT[conditionType];
  if (!text) {
    throw new Error(`${conditionType} is not a Level 1 condition type (02_42 §57) -- refusing to send an unbounded message.`);
  }
  return text;
}

/** Static, bounded alert template (02_42 §61) -- severity is always fixed SEV-1, the only severity Level 1 can ever produce. */
export function buildAlertMessage({ environment, condition, detectedAt }) {
  return [
    "QUEST CITY ALERT — EXTERNAL MONITOR",
    "Severity: SEV-1",
    `Service: ${condition.service}`,
    `Problem: ${problemText(condition.conditionType)}`,
    `Detected: ${detectedAt}`,
    `Environment: ${environment.toLowerCase()}`,
    "Note: Control Center unreachable — bypass alert (Level 1)",
  ].join("\n");
}

/** Symmetric static recovery template (02_42 §61). */
export function buildRecoveryMessage({ environment, condition, recoveredAt }) {
  return [
    "QUEST CITY RECOVERY — EXTERNAL MONITOR",
    "Severity: SEV-1",
    `Service: ${condition.service}`,
    `Problem: ${problemText(condition.conditionType)} (resolved)`,
    `Recovered: ${recoveredAt}`,
    `Environment: ${environment.toLowerCase()}`,
    "Note: Control Center unreachable — bypass alert (Level 1)",
  ].join("\n");
}

/**
 * Sends one Telegram message via the Bot API. Never logs, returns, or
 * embeds the bot token anywhere in its result or thrown errors -- only the
 * chat id (never printed by the caller either, per the mission's PDF/report
 * redaction rules) and the HTTP outcome are surfaced.
 */
export async function sendTelegramMessage({ botToken, chatId, text, timeoutMs = 10_000 }, deps = {}) {
  const { fetchImpl = fetch } = deps;
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are both required for a Level 1 direct send.");
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Never interpolate `error` verbatim if it could ever echo the URL
    // (it can't here -- fetch errors don't include the request body/token
    // in their message -- but a fixed, generic message is used regardless
    // as defense in depth against a future Node/undici error-message
    // change that might).
    return { ok: false, status: null, error: "Telegram request failed (network-level)." };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: `Telegram API returned HTTP ${response.status}.` };
  }
  return { ok: true, status: response.status, error: null };
}
