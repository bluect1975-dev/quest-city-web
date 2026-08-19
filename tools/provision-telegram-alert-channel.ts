#!/usr/bin/env -S npx tsx
// Master Admin Operations Control Center -- Telegram alert channel
// server-side provisioning (02_42 §30, 07_06 §9; TELEGRAM-DEPLOYMENT-
// PROVISIONING mission). Wires alert_configuration.recipient_ref/
// credential_ref from server-side environment variables so `CONFIGURED`
// never requires a manual SQL UPDATE by an operator. Never reads,
// prints, or persists the Bot Token value itself -- credential_ref is
// only the name of the environment variable that holds it.
//
// Idempotent: safe to run on every deploy/bootstrap. If
// TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are both absent from the
// environment, this is a no-op (LocalMockAlertChannelAdapter remains
// active, matching apps/api/lib/operations-context.ts's own selection
// logic). If exactly one of the two is set, that is a misconfiguration
// and the script fails loudly rather than silently leaving a half-wired
// channel. Never touches `enabled`/`severity_threshold`/`cooldown_seconds`
// -- those remain a PLATFORM_ADMIN's own operational decision, made via
// the Control Center UI, and are never overridden by this script on a
// re-run.
//
// Usage: DATABASE_URL=postgresql://... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
//   pnpm --filter @quest-city-web/tools run provision:telegram-alert-channel

import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
const { Pool } = pg;
import { AlertConfigurationRepository } from "@quest-city-web/operations";

function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return "*".repeat(chatId.length);
  return `${"*".repeat(chatId.length - 4)}${chatId.slice(-4)}`;
}

export async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken && !chatId) {
    // eslint-disable-next-line no-console -- no-op summary, no secret involved.
    console.log(
      "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are not set in this environment -- skipping Telegram alert channel provisioning (LocalMockAlertChannelAdapter remains active).",
    );
    return;
  }
  if (!botToken || !chatId) {
    const missing = !botToken ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_CHAT_ID";
    throw new Error(`Incomplete Telegram configuration: ${missing} is not set while the other variable is. Set both or neither.`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to provision the Telegram alert channel.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repo = new AlertConfigurationRepository(pool);
    const result = await repo.provisionCredentialReferences({
      channel: "TELEGRAM",
      recipientRef: chatId,
      credentialRef: "TELEGRAM_BOT_TOKEN",
    });
    // eslint-disable-next-line no-console -- controlled, non-secret summary output (Chat ID masked).
    console.log(
      `Telegram alert channel provisioned: credential_ref=${result.credentialRef}, recipient=${maskChatId(chatId)}, ` +
        `enabled=${result.enabled}, severityThreshold=${result.severityThreshold}, cooldownSeconds=${result.cooldownSeconds}.`,
    );
  } finally {
    await pool.end();
  }
}

// Cross-platform entrypoint check -- comparing import.meta.url against a
// raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
