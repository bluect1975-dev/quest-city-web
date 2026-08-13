import type { ConvergenceRequest, MigrationExecution } from "@quest-city-web/convergence";

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
 * OpenAPI v1.12 `MigrationExecutionResponse` names the terminal status
 * field `executionStatus`; the domain model's DB column and `status`
 * property follow the repository-wide `status` naming convention instead.
 */
export function toMigrationExecutionResponse(execution: MigrationExecution): Omit<MigrationExecution, "status"> & { executionStatus: MigrationExecution["status"] } {
  const { status, ...rest } = execution;
  return { ...rest, executionStatus: status };
}
