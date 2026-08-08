import type { Queryable } from "./types";

/**
 * Append-only audit trail (02_25 §6.10, reused unmodified for Web identity
 * events per §6.11). `metadataRedacted` must never carry a PIN, class
 * code, session token or CSRF token in any form — callers are responsible
 * for redaction before calling `record` (07_16 §17: "Non registrare
 * codici, password, token o dati anagrafici completi").
 */
export type AuditActorType = "STUDENT" | "SYSTEM" | "ADMIN" | "STAFF";
export type AuditResult = "SUCCESS" | "FAILURE";

export interface AuditEventInput {
  tenantId: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result: AuditResult;
  metadataRedacted?: Record<string, unknown>;
}

export class AuditRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: AuditEventInput): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_event (tenant_id, actor_type, actor_id, action, target_type, target_id, result, metadata_redacted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.tenantId,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.result,
        JSON.stringify(input.metadataRedacted ?? {}),
      ],
    );
  }
}
