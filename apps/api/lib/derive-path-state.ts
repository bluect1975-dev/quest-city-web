/**
 * `GET /me/path` (Pilot Product Experience Residual Closure, Tranche H3).
 * Pure function, independently unit-testable — same rationale as
 * `resolveEffectiveAvailability`'s own doc comment ("make the resolver
 * independently unit-testable, do not bury cascade semantics inside UI/
 * controller code"): the composite state a student sees combines two
 * independent axes (attempt completion, real GLPC availability) and that
 * combination rule deserves its own test coverage, not just a route
 * handler's inline conditionals.
 *
 * Precedence: an already-COMPLETED item stays COMPLETED even if a policy
 * later disables it (a real past achievement is never hidden
 * retroactively); otherwise GLPC unavailability wins over attempt
 * progress (LOCKED); otherwise an IN_PROGRESS attempt is CURRENT;
 * anything else still available and not started is AVAILABLE.
 */
export type PathCompletionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type PathEffectiveAvailability = "EFFECTIVE_AVAILABLE" | "EFFECTIVE_UNAVAILABLE";
export type PathState = "COMPLETED" | "LOCKED" | "CURRENT" | "AVAILABLE";

export function derivePathState(
  completionStatus: PathCompletionStatus,
  effectiveAvailability: PathEffectiveAvailability,
): PathState {
  if (completionStatus === "COMPLETED") {
    return "COMPLETED";
  }
  if (effectiveAvailability === "EFFECTIVE_UNAVAILABLE") {
    return "LOCKED";
  }
  return completionStatus === "IN_PROGRESS" ? "CURRENT" : "AVAILABLE";
}
