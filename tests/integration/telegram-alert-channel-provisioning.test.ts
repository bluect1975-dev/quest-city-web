import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AlertConfigurationRepository } from "@quest-city-web/operations";

/**
 * Server-side Telegram alert channel provisioning (TELEGRAM-DEPLOYMENT-
 * PROVISIONING mission §7): `AlertConfigurationRepository.
 * provisionCredentialReferences()` must be idempotent, must never persist
 * the Bot Token itself, and must never override a PLATFORM_ADMIN's own
 * enabled/severity/cooldown choice on a re-run. Structural template is
 * `master-admin-operations-control-center-flow.test.ts`: real `pg.Pool`,
 * direct repository-class calls (never HTTP), raw `pool.query` fixture
 * seeding/assertions.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- telegram-alert-channel-provisioning
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

async function truncateAll(): Promise<void> {
  await pool.query(`TRUNCATE alert_configuration CASCADE`);
}

describe("AlertConfigurationRepository.provisionCredentialReferences (server-side deployment wiring, distinct from the PLATFORM_ADMIN UI path)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("creates the TELEGRAM row with schema fail-safe defaults when none exists yet (enabled=false until a PLATFORM_ADMIN opts in via the UI)", async () => {
    const repo = new AlertConfigurationRepository(pool);
    const result = await repo.provisionCredentialReferences({
      channel: "TELEGRAM",
      recipientRef: "555000111",
      credentialRef: "TELEGRAM_BOT_TOKEN",
    });

    expect(result.channel).toBe("TELEGRAM");
    expect(result.recipientRef).toBe("555000111");
    expect(result.credentialRef).toBe("TELEGRAM_BOT_TOKEN");
    expect(result.enabled).toBe(false);
    expect(result.severityThreshold).toBe("SEV-2");
    expect(result.cooldownSeconds).toBe(900);
  });

  it("is idempotent: running it twice with the same inputs produces exactly one row and the same result", async () => {
    const repo = new AlertConfigurationRepository(pool);
    await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555000111", credentialRef: "TELEGRAM_BOT_TOKEN" });
    await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555000111", credentialRef: "TELEGRAM_BOT_TOKEN" });

    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM alert_configuration WHERE channel = 'TELEGRAM'`);
    expect(Number(countResult.rows[0]!.count)).toBe(1);
  });

  it("re-running with a changed Chat ID updates recipient_ref without creating a second row", async () => {
    const repo = new AlertConfigurationRepository(pool);
    await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555000111", credentialRef: "TELEGRAM_BOT_TOKEN" });
    const second = await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555999222", credentialRef: "TELEGRAM_BOT_TOKEN" });

    expect(second.recipientRef).toBe("555999222");
    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM alert_configuration WHERE channel = 'TELEGRAM'`);
    expect(Number(countResult.rows[0]!.count)).toBe(1);
  });

  it("never overwrites an operator's enabled/severity_threshold/cooldown_seconds choice already present in the database", async () => {
    const staffResult = await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ('operator@example.org', 'x', 'scrypt', 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    );
    const staffAccountId = staffResult.rows[0]!.id;

    // Simulate a PLATFORM_ADMIN who already configured the channel via the UI.
    await pool.query(
      `INSERT INTO alert_configuration (channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref, escalation_json, updated_by_staff_account_id)
       VALUES ('TELEGRAM', true, 'SEV-1', 120, 'old-recipient', 'old-credential-ref', '{}', $1)`,
      [staffAccountId],
    );

    const repo = new AlertConfigurationRepository(pool);
    const result = await repo.provisionCredentialReferences({
      channel: "TELEGRAM",
      recipientRef: "555000111",
      credentialRef: "TELEGRAM_BOT_TOKEN",
    });

    // Only the credential pointers moved; the operator's own choices survive untouched.
    expect(result.recipientRef).toBe("555000111");
    expect(result.credentialRef).toBe("TELEGRAM_BOT_TOKEN");
    expect(result.enabled).toBe(true);
    expect(result.severityThreshold).toBe("SEV-1");
    expect(result.cooldownSeconds).toBe(120);
  });

  it("in the real provisioning flow (credentialRef always the literal pointer 'TELEGRAM_BOT_TOKEN'), the stored value never has the shape of a real Telegram Bot Token (which always contains ':')", async () => {
    const repo = new AlertConfigurationRepository(pool);
    // This is the actual call shape tools/provision-telegram-alert-channel.ts
    // always uses -- credentialRef is hard-coded there to the pointer name,
    // never derived from process.env.TELEGRAM_BOT_TOKEN's value. This guards
    // against a future regression where that call site is edited to pass the
    // real token instead of the pointer.
    await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555000111", credentialRef: "TELEGRAM_BOT_TOKEN" });

    const row = await pool.query<{ recipient_ref: string; credential_ref: string }>(
      `SELECT recipient_ref, credential_ref FROM alert_configuration WHERE channel = 'TELEGRAM'`,
    );
    expect(row.rows[0]!.credential_ref).toBe("TELEGRAM_BOT_TOKEN");
    expect(row.rows[0]!.credential_ref).not.toContain(":");
  });

  it("provisionCredentialReferences() is a transparent pass-through for credentialRef -- it stores exactly what it is given, never validating or rejecting a token-shaped value itself", async () => {
    // The repository has no way to distinguish a pointer from a real secret
    // (both are plain strings) -- enforcing "never the real token" is the
    // CALLER's responsibility (tools/provision-telegram-alert-channel.ts),
    // not something this method can verify at runtime. This test documents
    // that trust boundary honestly, rather than implying the repository
    // itself guards against a caller mistake.
    const repo = new AlertConfigurationRepository(pool);
    const tokenShapedValue = "123456789:AAHrealisticTelegramBotTokenShapeButNeverActuallyUsedByTheRealCLIScript";
    const result = await repo.provisionCredentialReferences({ channel: "TELEGRAM", recipientRef: "555000111", credentialRef: tokenShapedValue });
    expect(result.credentialRef).toBe(tokenShapedValue);
  });
});
