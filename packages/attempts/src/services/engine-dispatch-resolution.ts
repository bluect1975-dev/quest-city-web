/**
 * `contentId -> { runtimeAdapterId, config }` resolution for attempt
 * consolidation (R3C.1 §40). Exactly one real entry exists today —
 * `fixture-balance-machine` — because it is the only content this
 * repository actually serves at runtime (`content-runtime`'s
 * `SERVABLE_BUNDLE_TYPES` allows only `RUNTIME_FIXTURE_BUNDLE`, R3C.0
 * finding). This is deliberately NOT a general content pipeline
 * (out of scope per §37-39) — it formalizes, generically and by
 * `runtimeAdapterId` rather than by a single hardcoded function call, the
 * exact one content/engine mapping that already existed implicitly before
 * this phase. The token weights below match
 * `packages/test-fixtures/src/balance-machine-fixture.ts`'s
 * `balanceMachineSemanticActions` (`w5`/`w5b`, weight 5 each) — not
 * invented, mirrored from the one real fixture this repository ships.
 *
 * Adding Quick/Drag entries here requires a real content bundle for each
 * (M06 content materialization), which is explicitly out of R3C.1 scope —
 * so an attempt against content that only exists for Quick/Drag today has
 * no entry here and correctly falls through to the unknown-adapter,
 * score-less outcome path in `AttemptConsolidationService`.
 */
import {
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
} from "@quest-city-web/content-runtime";

export interface ResolvedEngineDispatch {
  runtimeAdapterId: string;
  config: unknown;
}

const KNOWN_CONTENT_DISPATCH: Record<string, ResolvedEngineDispatch> = {
  "fixture-balance-machine": {
    runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE",
    config: {
      tokens: [
        { tokenId: "w5", weight: 5 },
        { tokenId: "w5b", weight: 5 },
      ],
    },
  },
  // WEB-M4 (07_25 v1.0 §9): the real content bundle's `content_bundle.id`
  // (a fixed, seed-assigned UUID — see tools/seed-content-bundle.ts) is
  // what `attempt.contentId` actually carries in production (launch-context
  // sets `contentId: bundle.id`), so real dispatch must be keyed by that
  // same id, not by an arbitrary content string.
  [WEB_M4_MAT_M06_CONTENT_BUNDLE_ID]: {
    runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE",
    config: WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  },
  // M06 Web Full Vertical Slice Tranche 1 (07_26 v1.0 §14): the
  // GUIDED_PRACTICE stage's real content bundle — same rationale as
  // WEB-M4's entry above, keyed by the same fixed content_bundle.id
  // (tools/seed-tranche1-content-bundle.ts) attempt.contentId actually
  // carries. This dispatch only ever concerns the sequence's single
  // interactive stage (GUIDED_PRACTICE) — REFLECTION_AND_RESULT is
  // presentation-only and creates no attempt of its own.
  [WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID]: {
    runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION",
    config: WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  },
};

export function resolveEngineDispatch(contentId: string): ResolvedEngineDispatch | undefined {
  return KNOWN_CONTENT_DISPATCH[contentId];
}
