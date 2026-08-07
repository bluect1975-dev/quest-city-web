import { validateAgainst } from "@quest-city-web/content-schema";
import type { LearningAttemptRepository } from "../repository/learning-attempt-repository";
import type { SemanticActionLogEntry } from "../repository/semantic-action-log-repository";
import type { AttemptResponseRepository } from "../repository/attempt-response-repository";
import {
  BALANCE_MACHINE_ITEM_ID,
  BALANCE_MACHINE_VALIDATOR_VERSION,
  evaluateBalanceMachine,
} from "./balance-machine-validator";

export type CompleteAttemptResponseStatus =
  | "CONSOLIDATED"
  | "ACCEPTED_NOT_CONSOLIDATED"
  | "DUPLICATE"
  | "CONFLICT"
  | "RECONCILIATION_REQUIRED";

export interface ConsolidateInput {
  attemptId: string;
  tenantId: string;
  /**
   * The attempt's persisted semantic actions (`SemanticActionLogRepository
   * .findByAttempt`), fetched by the caller — this service does not read
   * the database itself for actions, keeping it testable against an
   * arbitrary in-memory action sequence.
   */
  actions: SemanticActionLogEntry[];
}

export interface ConsolidateResult {
  completionStatus: CompleteAttemptResponseStatus;
  outcome?: Record<string, unknown> | undefined;
  attemptId: string;
}

/**
 * AttemptConsolidationService (02_25 §28.3, 07_15_01 v1.1 §12): computes a
 * real, deterministic `outcome` (conforming to `outcome.schema.json`) from
 * the attempt's actual persisted semantic actions — via
 * `evaluateBalanceMachine`, the one real validator this repository
 * implements (`docs/adr/0003`) — records the scored item in
 * `attempt_response` (`validator_version`, `correctness`), and transitions
 * `attempt_state` to COMPLETED/CONSOLIDATED. The outcome is never accepted
 * verbatim from the client request body (07_08 §8) and is never invented
 * by this service or its caller: for an action sequence this repository's
 * validator does not recognize (a future, different activity), the outcome
 * omits `score` entirely rather than fabricating one — still schema-valid,
 * honestly absent a real result.
 *
 * Reward/mastery are explicitly out of WEB-M2 scope (07_15_01 v1.1 §12.2
 * still applies as an invariant for future work: never issue a second
 * reward or mastery advancement for the same completion).
 */
export class AttemptConsolidationService {
  constructor(
    private readonly attempts: LearningAttemptRepository,
    private readonly attemptResponses: AttemptResponseRepository,
  ) {}

  async consolidate(input: ConsolidateInput): Promise<ConsolidateResult> {
    const outcome = await this.computeOutcome(input.attemptId, input.tenantId, input.actions);

    const consolidated = await this.attempts.consolidate(input.attemptId, input.tenantId, outcome);
    if (!consolidated) {
      // The attempt was not in COMPLETION_SUBMITTED when this ran — most
      // likely a concurrent consolidation already completed it. Re-read to
      // report the real current state rather than guessing.
      const current = await this.attempts.findByIdAndTenant(input.attemptId, input.tenantId);
      if (current?.attemptState === "COMPLETED") {
        return { completionStatus: "DUPLICATE", outcome: current.outcome ?? undefined, attemptId: input.attemptId };
      }
      throw new Error(
        `AttemptConsolidationService: attempt ${input.attemptId} was not COMPLETION_SUBMITTED at consolidation time`,
      );
    }
    return { completionStatus: "CONSOLIDATED", outcome, attemptId: input.attemptId };
  }

  private async computeOutcome(
    attemptId: string,
    tenantId: string,
    actions: SemanticActionLogEntry[],
  ): Promise<Record<string, unknown>> {
    const consolidatedAt = new Date().toISOString();
    const evaluation = evaluateBalanceMachine(actions);

    const outcome: Record<string, unknown> = evaluation.matched
      ? { attemptId, completionStatus: "CONSOLIDATED", score: evaluation.score, consolidatedAt }
      : { attemptId, completionStatus: "CONSOLIDATED", consolidatedAt };

    const validation = validateAgainst("outcome", outcome);
    if (!validation.valid) {
      throw new Error(`Computed outcome failed outcome.schema.json validation: ${validation.errors.join("; ")}`);
    }

    if (evaluation.matched) {
      // Idempotent (ON CONFLICT DO NOTHING) — a retried consolidation for
      // the same attempt/item never overwrites the original computation.
      await this.attemptResponses.insert({
        tenantId,
        attemptId,
        itemId: BALANCE_MACHINE_ITEM_ID,
        responseJson: { leftWeight: evaluation.leftWeight, rightWeight: evaluation.rightWeight },
        correctness: evaluation.correctness,
        validatorVersion: BALANCE_MACHINE_VALIDATOR_VERSION,
      });
    }

    return outcome;
  }
}
