export type PresenceState = "ONLINE" | "IDLE" | "OFFLINE";

export interface PresenceThresholds {
  onlineThresholdMs: number;
  idleThresholdMs: number;
}

/** Reference pilot values (02_42 §14) -- configurable, never hardcoded elsewhere. */
export const DEFAULT_PRESENCE_THRESHOLDS: PresenceThresholds = {
  onlineThresholdMs: 120_000,
  idleThresholdMs: 600_000,
};

/**
 * Presence state is always derived at read time from `lastSeenAt`, never
 * persisted as a stored column (02_42 §14). `lastSeenAt === null` means no
 * presence row exists yet -- always OFFLINE.
 */
export function derivePresenceState(
  lastSeenAt: Date | null,
  now: Date,
  thresholds: PresenceThresholds = DEFAULT_PRESENCE_THRESHOLDS,
): PresenceState {
  if (!lastSeenAt) return "OFFLINE";
  const ageMs = now.getTime() - lastSeenAt.getTime();
  if (ageMs < 0) return "ONLINE"; // clock skew guard: never negative age
  if (ageMs <= thresholds.onlineThresholdMs) return "ONLINE";
  if (ageMs <= thresholds.idleThresholdMs) return "IDLE";
  return "OFFLINE";
}
