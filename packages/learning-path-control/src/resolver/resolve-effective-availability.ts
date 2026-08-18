/**
 * Deterministic Granular Learning Path Control resolution algorithm
 * (02_41 v1.1 §31). Pure function -- no I/O, no database access -- so it is
 * independently unit-testable without a database (02_41 §13/mission
 * §13: "Make the resolver independently unit-testable. Do not bury cascade
 * semantics inside UI/controller code."). Callers (the service layer) load
 * the relevant `LearningPathPolicyRow` rows for PLATFORM/SCHOOL/CLASS/
 * STUDENT ahead of time and pass them in -- this function never queries.
 *
 * Order-independent by construction: always evaluates
 * PLATFORM -> SCHOOL -> CLASS -> STUDENT in that fixed order, regardless of
 * the order the four policy rows are passed in (each is looked up by its
 * own `scope` field, not by array position).
 */

export type LearningPathScope = "PLATFORM" | "SCHOOL" | "CLASS" | "STUDENT";

export type LearningPathState =
  | "ENABLED"
  | "DISABLED"
  | "DISABLED_AND_WAIVED"
  | "DISABLED_WITH_ALTERNATIVE"
  | "UNAVAILABLE_FOR_USE";

export type LearningPathReasonCategory =
  | "PEDAGOGICAL"
  | "ACCESSIBILITY"
  | "TEMPORARY_SUPPORT"
  | "ALTERNATIVE_ACTIVITY"
  | "CURRICULUM_SCHEDULING"
  | "SCHOOL_POLICY"
  | "TEACHER_DECISION"
  | "OTHER_STRUCTURED";

export type LearningPathResourceType = "SUBJECT" | "TRACK" | "YEAR" | "MODULE" | "UNIT" | "UNIT_ELEMENT";

export type PedagogicalRole = "CORE_LEARNING_ACTIVITY" | "OPTIONAL_ENRICHMENT";

/** One explicit policy row at one scope, as loaded from `learning_path_policy`. Absence of a row for a scope means that scope is INHERIT (02_41 §9) -- never represented as a row with state='INHERIT'. */
export interface LearningPathPolicyInput {
  id: string;
  scope: LearningPathScope;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  alternativeContentRef: string | null;
}

export interface ResolveEffectiveAvailabilityInput {
  resourceType: LearningPathResourceType;
  resourceRef: string;
  /** Keyed by scope; a missing key means INHERIT at that scope (no explicit policy row exists). */
  policiesByScope: Partial<Record<LearningPathScope, LearningPathPolicyInput>>;
  /** OPTIONAL_ENRICHMENT by default (02_41 §25) if not supplied or explicitly undefined. */
  pedagogicalRole?: PedagogicalRole | undefined;
}

export type EffectiveAvailability = "EFFECTIVE_AVAILABLE" | "EFFECTIVE_UNAVAILABLE";
export type EffectiveRequirement = "required" | "waived" | "alternative";

export interface EffectiveResolution {
  resourceType: LearningPathResourceType;
  resourceRef: string;
  effectiveAvailability: EffectiveAvailability;
  effectiveRequirement: EffectiveRequirement;
  sourceScope: LearningPathScope;
  sourcePolicyId: string | null;
  alternativeContentRef: string | null;
  waiverState: boolean;
  reasonCategory: LearningPathReasonCategory | null;
  /** True when the accumulated effective state was set by a *different*, higher-priority scope than the last policy examined -- i.e. a lower-scope explicit policy exists but is currently shadowed (02_41 §11-12). Exposed so callers (preview/UI) can render "locked by School policy" without re-deriving it. */
  shadowedLowerScopePolicyIds: string[];
}

const SCOPE_ORDER: readonly LearningPathScope[] = ["PLATFORM", "SCHOOL", "CLASS", "STUDENT"];

/** A state counts as "restrictive" for hard-lock purposes if it is anything other than ENABLED/INHERIT (02_41 §10: DISABLED and its variants, plus UNAVAILABLE_FOR_USE, are all hard-lock-capable). */
function isRestrictive(state: LearningPathState): boolean {
  return state !== "ENABLED";
}

function deriveRequirement(
  state: LearningPathState,
  pedagogicalRole: PedagogicalRole,
): EffectiveRequirement {
  if (state === "DISABLED_AND_WAIVED") return "waived";
  if (state === "DISABLED_WITH_ALTERNATIVE") return "alternative";
  if (state === "DISABLED" || state === "UNAVAILABLE_FOR_USE") {
    // Plain DISABLED on OPTIONAL_ENRICHMENT content simply removes it from
    // the path (02_41 §25) -- never "required". On CORE_LEARNING_ACTIVITY
    // a plain DISABLED with no WAIVED/ALTERNATIVE variant is a contract
    // gap the caller should have prevented at write time (02_41 §25: core
    // content disabling "cannot always behave like simple hiding") -- the
    // resolver still returns a safe, non-fabricated answer rather than
    // inventing mastery: `waived` would fabricate evidence, so `required`
    // is the honest (if inconvenient) answer for CORE content left in this
    // state, surfacing the gap instead of hiding it.
    return pedagogicalRole === "CORE_LEARNING_ACTIVITY" ? "required" : "waived";
  }
  return "required";
}

/**
 * 02_41 §31 pseudocode, verbatim:
 *
 *   effective = platformState.state ?? ENABLED
 *   source = PLATFORM
 *   for (scope, state) in [SCHOOL, CLASS, STUDENT]:
 *     if state == INHERIT or state == null: continue
 *     if effective == DISABLED and state in [ENABLED]: continue   # hard lock
 *     effective = state.value
 *     source = scope
 *     sourcePolicyRef = state.policyId
 */
export function resolveEffectiveAvailability(input: ResolveEffectiveAvailabilityInput): EffectiveResolution {
  const pedagogicalRole = input.pedagogicalRole ?? "OPTIONAL_ENRICHMENT";

  let effectiveState: LearningPathState = "ENABLED";
  let sourceScope: LearningPathScope = "PLATFORM";
  let sourcePolicy: LearningPathPolicyInput | null = null;
  const shadowed: string[] = [];

  const platform = input.policiesByScope.PLATFORM;
  if (platform) {
    effectiveState = platform.state;
    sourcePolicy = platform;
  }

  for (const scope of SCOPE_ORDER.slice(1)) {
    const policy = input.policiesByScope[scope];
    if (!policy) continue; // INHERIT -- no row, nothing to evaluate

    // Hard lock (02_41 §10): once a higher scope has set a restrictive
    // state, a lower scope's attempt to go back to ENABLED never wins --
    // its policy is recorded as shadowed (persisted, inactive), never
    // discarded (02_41 §11-12).
    if (isRestrictive(effectiveState) && policy.state === "ENABLED") {
      shadowed.push(policy.id);
      continue;
    }

    effectiveState = policy.state;
    sourceScope = scope;
    sourcePolicy = policy;
  }

  const effectiveAvailability: EffectiveAvailability = effectiveState === "ENABLED" ? "EFFECTIVE_AVAILABLE" : "EFFECTIVE_UNAVAILABLE";

  return {
    resourceType: input.resourceType,
    resourceRef: input.resourceRef,
    effectiveAvailability,
    effectiveRequirement: deriveRequirement(effectiveState, pedagogicalRole),
    sourceScope,
    sourcePolicyId: sourcePolicy?.id ?? null,
    alternativeContentRef: effectiveState === "DISABLED_WITH_ALTERNATIVE" ? (sourcePolicy?.alternativeContentRef ?? null) : null,
    waiverState: effectiveState === "DISABLED_AND_WAIVED",
    reasonCategory: sourcePolicy?.reasonCategory ?? null,
    shadowedLowerScopePolicyIds: shadowed,
  };
}
