import { Pool } from "pg";
import {
  OverviewService,
  ServiceHealthStateRepository,
  OperationalMetricSampleRepository,
  PresenceService,
  IncidentService,
  AlertService,
  LocalMockAlertChannelAdapter,
  TelegramAlertChannelAdapter,
  type AlertChannelAdapter,
} from "@quest-city-web/operations";
import { loadEnv } from "./env";

/**
 * Own connection pool for the Master Admin Operations Control Center
 * (02_42 v1.0) -- same per-domain separation rationale as every prior
 * milestone's own pool (platform-identity-context.ts precedent). A new
 * domain (ops/observability), a different actor (PLATFORM_ADMIN via the
 * dashboard, plus student/staff for the shared heartbeat endpoint), and a
 * potentially higher-write access pattern (operational_metric_sample,
 * user_presence) all match exactly why platform-identity-context.ts was
 * split from staff-identity-context.ts rather than reusing it.
 */
let pool: Pool | undefined;

function getOperationsPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
    });
  }
  return pool;
}

export function getOperationsPoolForQueries(): Pool {
  return getOperationsPool();
}

/**
 * Alert channel adapter selection (02_42 §28-29): TELEGRAM_BOT_TOKEN/
 * TELEGRAM_CHAT_ID are read directly from process.env here -- never
 * accepted from a request, never returned by any API response, never
 * persisted in the database (07_06 §9 secret regime). Falls back to the
 * local/mock adapter whenever the real credential isn't configured, so
 * local dev/CI never requires a Telegram account (mission §45-46).
 */
let adapter: AlertChannelAdapter | undefined;

export function getAlertChannelAdapter(): AlertChannelAdapter {
  if (!adapter) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    adapter = botToken && chatId ? new TelegramAlertChannelAdapter({ botToken, chatId }) : new LocalMockAlertChannelAdapter();
  }
  return adapter;
}

export function getOverviewService(): OverviewService {
  return new OverviewService(getOperationsPool());
}

export function getServiceHealthStateRepository(): ServiceHealthStateRepository {
  return new ServiceHealthStateRepository(getOperationsPool());
}

export function getOperationalMetricSampleRepository(): OperationalMetricSampleRepository {
  return new OperationalMetricSampleRepository(getOperationsPool());
}

export function getPresenceService(): PresenceService {
  return new PresenceService(getOperationsPool());
}

export function getIncidentService(): IncidentService {
  return new IncidentService(getOperationsPool());
}

export function getAlertService(): AlertService {
  return new AlertService(getOperationsPool(), getAlertChannelAdapter());
}
