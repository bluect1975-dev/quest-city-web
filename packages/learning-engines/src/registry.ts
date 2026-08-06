/**
 * Engine registration contract (07_05 §10.1). Every engine declares an id,
 * version, supported activity types, capability requirements and a fallback
 * engine. No engine is implemented at WEB-M0 — this module only holds the
 * registry mechanism so `apps/api` and future runtime hosts have a stable
 * import target once engines land (Step 5, 07_10 §28).
 */
export interface EngineRegistration {
  engineId: string;
  engineVersion: string;
  supportedActivityTypes: string[];
  capabilityRequirements: string[];
  fallbackEngineId?: string;
}

export class EngineRegistry {
  private readonly engines = new Map<string, EngineRegistration>();

  register(engine: EngineRegistration): void {
    if (this.engines.has(engine.engineId)) {
      throw new Error(`Engine already registered: ${engine.engineId}`);
    }
    this.engines.set(engine.engineId, engine);
  }

  get(engineId: string): EngineRegistration | undefined {
    return this.engines.get(engineId);
  }

  list(): EngineRegistration[] {
    return [...this.engines.values()];
  }
}
