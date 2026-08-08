import { validateAgainst } from "@quest-city-web/content-schema";
import { replayActions, type EngineRuntimeRegistry, type EngineSemanticAction } from "@quest-city-web/learning-engines";
import type { LearningAttemptRepository } from "../repository/learning-attempt-repository";
import type { SemanticActionLogEntry } from "../repository/semantic-action-log-repository";
import type { AttemptResponseRepository } from "../repository/attempt-response-repository";
import { resolveEngineDispatch } from "./engine-dispatch-resolution";

export type CompleteAttemptResponseStatus =
  | "CONSOLIDATED"
  | "ACCEPTED_NOT_CONSOLIDATED"
  | "DUPLICATE"
  | "CONFLICT"
  | "RECONCILIATION_REQUIRED";

export interface ConsolidateInput {
  attemptId: string;
  tenantId: string;
  /** `learning_attempt.content_id` — resolves which engine (if any) evaluates this attempt (R3C.1 §40). */
  contentId: string;
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
 * the attempt's actual persisted semantic actions, records the scored item
 * in `attempt_response` (`validator_version`, `correctness`), and
 * transitions `attempt_state` to COMPLETED/CONSOLIDATED. The outcome is
 * never accepted verbatim from the client request body (07_08 §8) and is
 * never invented by this service or its caller.
 *
 * R3C.1: dispatch generalized from a single hardcoded
 * `evaluateBalanceMachine()` call to a registry-driven lookup —
 * `resolveEngineDispatch(contentId)` finds the `runtimeAdapterId` and
 * configuration for this attempt's content, `engines.getByRuntimeAdapterId`
 * resolves the actual `EngineDefinition`, and `replayActions` +
 * `engine.evaluate` compute the result generically for any of the 3 P0
 * engines. If content has no resolvable dispatch, or references a
 * `runtimeAdapterId` not registered in `engines` (an unpublished/future
 * engine — §41: never a fallback to a similar engine), the outcome omits
 * `score` entirely — still schema-valid, honestly absent a real result,
 * exactly the same shape the old fixture-only fallback produced.
 *
 * Reward/mastery are explicitly out of WEB-M2 scope (07_15_01 v1.1 §12.2
 * still applies as an invariant for future work: never issue a second
 * reward or mastery advancement for the same completion).
 */
export class AttemptConsolidationService {
  constructor(
    private readonly attempts: LearningAttemptRepository,
    private readonly attemptResponses: AttemptResponseRepository,
    private readonly engines: EngineRuntimeRegistry,
  ) {}

  async consolidate(input: ConsolidateInput): Promise<ConsolidateResult> {
    const outcome = await this.computeOutcome(input.attemptId, input.tenantId, input.contentId, input.actions);

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
    contentId: string,
    actions: SemanticActionLogEntry[],
  ): Promise<Record<string, unknown>> {
    const consolidatedAt = new Date().toISOString();

    const dispatch = resolveEngineDispatch(contentId);
    const engine = dispatch ? this.engines.getByRuntimeAdapterId(dispatch.runtimeAdapterId) : undefined;

    let scoredCorrectness: "CORRECT" | "INCORRECT" | undefined;
    let scoredValue: 0 | 1 | undefined;
    let evidence: Record<string, unknown> | undefined;
    let validatorVersion: string | undefined;

    if (dispatch && engine) {
      const configValidation = engine.validateConfig(dispatch.config);
      if (configValidation.valid) {
        const { state } = replayActions(engine, configValidation.config, actions as EngineSemanticAction[]);
        const evaluation = engine.evaluate(state, configValidation.config);
        if (evaluation.evaluated) {
          scoredCorrectness = evaluation.correctness;
          scoredValue = evaluation.score;
          evidence = evaluation.evidence;
          validatorVersion = `${engine.runtimeAdapterId}@${engine.engineVersion}`;
        }
      }
      // configValidation.valid === false is a content/engine-config defect,
      // not a client input problem — never fabricate a score from it either.
    }
    // dispatch or engine undefined: unknown/unregistered adapter (§41) —
    // never fall back to a similar engine, never invent ENGINE_GAP here
    // (that stays a design-time Support Evaluator concern).

    const outcome: Record<string, unknown> =
      scoredValue !== undefined
        ? { attemptId, completionStatus: "CONSOLIDATED", score: scoredValue, consolidatedAt }
        : { attemptId, completionStatus: "CONSOLIDATED", consolidatedAt };

    const validation = validateAgainst("outcome", outcome);
    if (!validation.valid) {
      throw new Error(`Computed outcome failed outcome.schema.json validation: ${validation.errors.join("; ")}`);
    }

    if (scoredCorrectness !== undefined && validatorVersion !== undefined) {
      // Idempotent (ON CONFLICT DO NOTHING) — a retried consolidation for
      // the same attempt/item never overwrites the original computation.
      await this.attemptResponses.insert({
        tenantId,
        attemptId,
        itemId: contentId,
        responseJson: evidence ?? {},
        correctness: scoredCorrectness,
        validatorVersion,
      });
    }

    return outcome;
  }
}
