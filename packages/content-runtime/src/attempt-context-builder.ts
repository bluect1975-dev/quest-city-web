import { validateAgainst } from "@quest-city-web/content-schema";

/**
 * Builds and validates an AttemptContext (07_09 §9) from a
 * `learning_attempt` row shape. Server-authoritative: the caller passes
 * already-loaded row data, this module only assembles and validates the
 * wire shape — it does not read the database itself (see
 * @quest-city-web/attempts for the tenant-scoped repository).
 */
export interface LearningAttemptRow {
  attemptId: string;
  attemptVersion: number;
  userPublicId: string;
  activityId: string;
  activityVersion: string;
  mode?: string;
  runtimeChannel: "WEB" | "ROBLOX";
  runtimeVersion?: string;
  adapterId?: string;
  adapterVersion?: string;
  seed?: string;
  state: "CREATED" | "IN_PROGRESS" | "COMPLETION_SUBMITTED" | "COMPLETED" | "ABANDONED" | "EXPIRED";
  currentStageId?: string;
  serverSequence: number;
  permissions?: Record<string, unknown>;
  offlinePolicy?: string;
  expiresAt?: string;
}

export interface BuildAttemptContextResult {
  ok: boolean;
  context?: LearningAttemptRow;
  errors: string[];
}

export function buildAttemptContext(row: LearningAttemptRow): BuildAttemptContextResult {
  const result = validateAgainst("attemptContext", row);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, context: row, errors: [] };
}
