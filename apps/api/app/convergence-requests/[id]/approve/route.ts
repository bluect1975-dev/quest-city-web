import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import type { ClassDecisionEntry, OwnershipDecisionEntry } from "@quest-city-web/convergence";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString } from "../../../../lib/staff-validation";
import { getConvergenceApprovalService } from "../../../../lib/staff-identity-context";
import { toConvergenceRequestSummary } from "../../../../lib/convergence-serialization";

const CLASS_DECISION_VALUES = new Set(["TRANSFER", "RETAIN"]);
const OWNERSHIP_DECISION_VALUES = new Set(["PROMOTE", "RETAIN"]);

function parseClassDecisions(value: unknown): ClassDecisionEntry[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new StaffIdentityError("VALIDATION_ERROR", "classDecisions must be an array when provided");
  }
  return value.map((entry): ClassDecisionEntry => {
    const row = entry as Record<string, unknown>;
    if (typeof row !== "object" || row === null || typeof row.classId !== "string" || !CLASS_DECISION_VALUES.has(row.decision as string)) {
      throw new StaffIdentityError("VALIDATION_ERROR", "each classDecisions entry must have classId (string) and decision (TRANSFER|RETAIN)");
    }
    return { classId: row.classId, decision: row.decision as ClassDecisionEntry["decision"] };
  });
}

function parseOwnershipDecisions(value: unknown): OwnershipDecisionEntry[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new StaffIdentityError("VALIDATION_ERROR", "ownershipDecisions must be an array when provided");
  }
  return value.map((entry): OwnershipDecisionEntry => {
    const row = entry as Record<string, unknown>;
    if (typeof row !== "object" || row === null || typeof row.resourceId !== "string" || !OWNERSHIP_DECISION_VALUES.has(row.decision as string)) {
      throw new StaffIdentityError("VALIDATION_ERROR", "each ownershipDecisions entry must have resourceId (string) and decision (PROMOTE|RETAIN)");
    }
    return { resourceId: row.resourceId, decision: row.decision as OwnershipDecisionEntry["decision"] };
  });
}

/**
 * `POST /convergence-requests/{id}/approve` (02_38 v1.4 §10.3, 02_26
 * v1.14 §36.5). Unified teacher/school confirmation endpoint -- which
 * side approved is resolved server-side from the caller's tenant, never
 * from the request body. No Idempotency-Key: concurrency is guarded by
 * `migrationPlanFingerprint` matching inside the service.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { id } = await params;
    const body = await parseStaffJsonBody(request);
    const migrationPlanFingerprint = validateNonEmptyString(body.migrationPlanFingerprint, "migrationPlanFingerprint");
    const classDecisions = parseClassDecisions(body.classDecisions);
    const ownershipDecisions = parseOwnershipDecisions(body.ownershipDecisions);

    const result = await getConvergenceApprovalService().approve(identity, id, {
      migrationPlanFingerprint,
      ...(classDecisions !== undefined ? { classDecisions } : {}),
      ...(ownershipDecisions !== undefined ? { ownershipDecisions } : {}),
    });

    return NextResponse.json(
      {
        data: toConvergenceRequestSummary(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
