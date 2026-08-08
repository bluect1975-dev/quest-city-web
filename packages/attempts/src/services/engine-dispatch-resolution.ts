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
};

export function resolveEngineDispatch(contentId: string): ResolvedEngineDispatch | undefined {
  return KNOWN_CONTENT_DISPATCH[contentId];
}
