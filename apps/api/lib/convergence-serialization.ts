import type { ConvergenceRequest, MigrationExecution, MigrationPlan } from "@quest-city-web/convergence";

/**
 * OpenAPI v1.12 `ConvergenceRequestSummary` requires `requestedAt`; the
 * domain model tracks the same moment as `createdAt` (row creation time).
 * Mapped here at the wire boundary rather than renaming the domain field,
 * since `createdAt`/`updatedAt` are the established convention every other
 * repository in this codebase uses.
 */
export function toConvergenceRequestSummary(request: ConvergenceRequest): ConvergenceRequest & { requestedAt: Date } {
  return { ...request, requestedAt: request.createdAt };
}

export function toConvergenceRequestSummaryList(requests: ConvergenceRequest[]): Array<ConvergenceRequest & { requestedAt: Date }> {
  return requests.map(toConvergenceRequestSummary);
}

/**
 * Additive enrichment of `ConvergenceRequestSummary` for the staff-session
 * detail read: includes the current `migrationPlan` (fingerprint,
 * classesConsidered, already-recorded classDecisions/ownershipDecisions,
 * ownershipDecisionsPending) so the approving party's UI can render
 * per-class TRANSFER/RETAIN choices without a new endpoint -- this is the
 * same data PLATFORM_ADMIN already sees via `POST .../preview`, just
 * surfaced as a read on the request's already-generated plan.
 */
export function toConvergenceRequestSummaryWithPlan(
  request: ConvergenceRequest,
  migrationPlan: MigrationPlan | null,
): ConvergenceRequest & { requestedAt: Date; migrationPlan: MigrationPlan | null } {
  return { ...toConvergenceRequestSummary(request), migrationPlan };
}

/**
 * OpenAPI v1.12 `MigrationExecutionResponse` names the terminal status
 * field `executionStatus`; the domain model's DB column and `status`
 * property follow the repository-wide `status` naming convention instead.
 */
export function toMigrationExecutionResponse(execution: MigrationExecution): Omit<MigrationExecution, "status"> & { executionStatus: MigrationExecution["status"] } {
  const { status, ...rest } = execution;
  return { ...rest, executionStatus: status };
}
