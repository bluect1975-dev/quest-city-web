import { NextResponse } from "next/server";
import { assertCapability } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../lib/platform-error-response";
import { getPlatformAdminPoolForQueries } from "../../../lib/platform-identity-context";
import { validatePaginationQuery } from "../../../lib/platform-validation";

interface AuditEventRow {
  id: string;
  tenant_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  result: string;
  created_at: Date;
}

/**
 * `GET /platform/audit` (capability `audit.read.global`). Read-only
 * listing over the existing `audit_event` table -- no new table, no
 * didactic data (audit rows for this domain never carry student
 * content).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "audit.read.global");
    const { limit, offset } = validatePaginationQuery(new URL(request.url));

    const pool = getPlatformAdminPoolForQueries();
    const result = await pool.query<AuditEventRow>(
      `SELECT id, tenant_id, actor_type, actor_id, action, target_type, target_id, result, created_at
       FROM audit_event ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return NextResponse.json(
      {
        data: result.rows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          actorType: row.actor_type,
          actorId: row.actor_id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          result: row.result,
          createdAt: row.created_at.toISOString(),
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
