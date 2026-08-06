import { randomUUID } from "node:crypto";

/**
 * Structured JSON logger with a mandatory correlation ID (07_05 §14,
 * deliverable 18). Never log free student text — only technical/telemetry
 * fields, per 07_05 §14: "Non registrare testo libero dello studente nei
 * log tecnici."
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId: string;
  message: string;
  fields?: LogFields;
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function createLogger(defaultCorrelationId?: string) {
  function log(level: LogLevel, message: string, fields?: LogFields, correlationId?: string) {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlationId: correlationId ?? defaultCorrelationId ?? newCorrelationId(),
      message,
      ...(fields ? { fields } : {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console -- this package's whole purpose is structured console logging.
      console.info(line);
    }
    return entry;
  }

  return {
    debug: (message: string, fields?: LogFields, correlationId?: string) =>
      log("debug", message, fields, correlationId),
    info: (message: string, fields?: LogFields, correlationId?: string) =>
      log("info", message, fields, correlationId),
    warn: (message: string, fields?: LogFields, correlationId?: string) =>
      log("warn", message, fields, correlationId),
    error: (message: string, fields?: LogFields, correlationId?: string) =>
      log("error", message, fields, correlationId),
  };
}
