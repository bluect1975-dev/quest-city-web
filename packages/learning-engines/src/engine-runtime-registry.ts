import type { EngineDefinition } from "./engine-runtime";

/**
 * Executable-engine lookup, keyed by identity. Deliberately separate from
 * `EngineRegistry` (registry.ts): that one is publication/governance
 * metadata (lifecycleStatus, capability declarations for the Support
 * Evaluator) and starts empty by design (the "Registry Update Gate").
 * This one holds the actual runnable `EngineDefinition` instances a
 * dispatcher calls `applyAction`/`evaluate` on — a different concern,
 * queried by `runtimeAdapterId` (what a persisted attempt/content
 * references) rather than by lifecycle status.
 */
export class EngineAlreadyRegisteredError extends Error {
  constructor(key: string) {
    super(`Engine already registered for runtime adapter id: ${key}`);
    this.name = "EngineAlreadyRegisteredError";
  }
}

export class EngineRuntimeRegistry {
  private readonly byRuntimeAdapterId = new Map<string, EngineDefinition<unknown, unknown>>();
  private readonly byCanonicalEngineId = new Map<string, EngineDefinition<unknown, unknown>[]>();

  register(engine: EngineDefinition<unknown, unknown>): void {
    if (this.byRuntimeAdapterId.has(engine.runtimeAdapterId)) {
      throw new EngineAlreadyRegisteredError(engine.runtimeAdapterId);
    }
    this.byRuntimeAdapterId.set(engine.runtimeAdapterId, engine);
    const siblings = this.byCanonicalEngineId.get(engine.canonicalEngineId) ?? [];
    siblings.push(engine);
    this.byCanonicalEngineId.set(engine.canonicalEngineId, siblings);
  }

  getByRuntimeAdapterId(runtimeAdapterId: string): EngineDefinition<unknown, unknown> | undefined {
    return this.byRuntimeAdapterId.get(runtimeAdapterId);
  }

  getByCanonicalEngineId(canonicalEngineId: string): EngineDefinition<unknown, unknown>[] {
    return this.byCanonicalEngineId.get(canonicalEngineId) ?? [];
  }

  list(): EngineDefinition<unknown, unknown>[] {
    return [...this.byRuntimeAdapterId.values()];
  }
}
