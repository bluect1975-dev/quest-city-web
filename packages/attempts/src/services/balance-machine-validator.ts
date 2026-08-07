import type { SemanticActionLogEntry } from "../repository/semantic-action-log-repository";

/**
 * Deterministic validator for the Balance Machine `RUNTIME_FIXTURE_BUNDLE`
 * (`packages/test-fixtures/src/balance-machine-fixture.ts`,
 * `validatorRef: "fixture-validator-balance"`). This is the one real
 * content activity in this repository — interprets the canonical semantic
 * action vocabulary (07_08 §6) the fixture exercises: PLACE_ITEM entries
 * targeting `weight-token` with `{ tokenId, side, weight }`, followed by a
 * CONFIRM_SOLUTION targeting `confirm-button`. Never invents a score: any
 * action shape it does not recognize (a different/future activity, or a
 * malformed payload) returns `matched: false` rather than a fabricated
 * result — see `AttemptConsolidationService.consolidate()` for the
 * schema-valid, score-less fallback that applies in that case.
 */
export const BALANCE_MACHINE_VALIDATOR_REF = "fixture-validator-balance";
export const BALANCE_MACHINE_VALIDATOR_VERSION = "0.0.1";
export const BALANCE_MACHINE_ITEM_ID = "fixture-balance-machine";

export type BalanceMachineEvaluation =
  | {
      matched: true;
      correctness: "CORRECT" | "INCORRECT";
      score: 0 | 1;
      leftWeight: number;
      rightWeight: number;
    }
  | { matched: false };

export function evaluateBalanceMachine(actions: SemanticActionLogEntry[]): BalanceMachineEvaluation {
  const confirmed = actions.some(
    (action) => action.actionType === "CONFIRM_SOLUTION" && action.targetRole === "confirm-button",
  );
  if (!confirmed) {
    return { matched: false };
  }

  const placements = actions.filter(
    (action) => action.actionType === "PLACE_ITEM" && action.targetRole === "weight-token",
  );
  if (placements.length === 0) {
    return { matched: false };
  }

  let leftWeight = 0;
  let rightWeight = 0;
  for (const placement of placements) {
    const side = placement.payload["side"];
    const weight = placement.payload["weight"];
    if ((side !== "left" && side !== "right") || typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      // Malformed placement payload — not a shape this validator can score.
      return { matched: false };
    }
    if (side === "left") {
      leftWeight += weight;
    } else {
      rightWeight += weight;
    }
  }

  const balanced = leftWeight === rightWeight;
  return {
    matched: true,
    correctness: balanced ? "CORRECT" : "INCORRECT",
    score: balanced ? 1 : 0,
    leftWeight,
    rightWeight,
  };
}
