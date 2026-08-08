/**
 * Canonical Engine Registry runtime (02_36 §5, engine-registry.schema.json,
 * R3A commit 945571b4...). Keyed by `canonicalEngineId` (owned by 02_21,
 * `ENG-*`), each entry may declare zero or more `runtimeAdapters` for the
 * Web channel (`runtimeAdapterId`, `QC-WEB-ENGINE-*`, owned by 07_10).
 * These two identifiers are never merged into one key (D9).
 *
 * Registry Update Gate (02_36 §13.3): registering an entry here does not by
 * itself make it "available" — that also requires a real implementation,
 * passing tests and a runtime adapter, none of which this module can
 * verify. WEB-M0/R3B scope: the registry mechanism and an empty registry —
 * no production engine is registered here (02_36 §5.4, 02_21 §4.1 remains
 * the sole authority on which canonical engines exist).
 */
import type { AxisAValue, EngineRegistryEntry, LifecycleStatus } from "./types";

export class EngineAlreadyRegisteredError extends Error {
  constructor(canonicalEngineId: string) {
    super(`Engine already registered: ${canonicalEngineId}`);
    this.name = "EngineAlreadyRegisteredError";
  }
}

export class EngineRegistry {
  private readonly engines = new Map<string, EngineRegistryEntry>();

  register(entry: EngineRegistryEntry): void {
    if (this.engines.has(entry.canonicalEngineId)) {
      throw new EngineAlreadyRegisteredError(entry.canonicalEngineId);
    }
    this.engines.set(entry.canonicalEngineId, entry);
  }

  /** Lookup by canonicalEngineId (ENG-*), the model-level identity owned by 02_21. */
  get(canonicalEngineId: string): EngineRegistryEntry | undefined {
    return this.engines.get(canonicalEngineId);
  }

  /** Lookup by runtimeAdapterId (QC-WEB-ENGINE-*), the Web-implementation identity owned by 07_10. */
  getByRuntimeAdapterId(runtimeAdapterId: string): EngineRegistryEntry | undefined {
    for (const entry of this.engines.values()) {
      if (entry.runtimeAdapters.some((a) => a.runtimeAdapterId === runtimeAdapterId)) {
        return entry;
      }
    }
    return undefined;
  }

  list(): EngineRegistryEntry[] {
    return [...this.engines.values()];
  }

  /** Entries at a given lifecycle status; ACTIVE is what publication eligibility requires. */
  listByLifecycle(status: LifecycleStatus): EngineRegistryEntry[] {
    return this.list().filter((e) => e.lifecycleStatus === status);
  }

  /** ACTIVE entries whose declared capabilities (required ∪ optional) cover every requested capability. */
  findByCapabilities(requiredCapabilities: readonly AxisAValue[]): EngineRegistryEntry[] {
    return this.listByLifecycle("ACTIVE").filter((entry) => {
      const declared = new Set<AxisAValue>([...entry.capabilities.required, ...entry.capabilities.optional]);
      return requiredCapabilities.every((c) => declared.has(c));
    });
  }

  /** Entries whose `templates` list references the given templateId (registry-side of the Template <-> Engine relation). */
  findByTemplate(templateId: string): EngineRegistryEntry[] {
    return this.list().filter((e) => e.templates?.includes(templateId));
  }

  /** Whether at least one WEB runtime adapter exists for this canonical engine, regardless of lifecycle. */
  hasRuntimeAdapter(canonicalEngineId: string, runtimeChannel: "WEB" | "ROBLOX" = "WEB"): boolean {
    const entry = this.get(canonicalEngineId);
    return entry?.runtimeAdapters.some((a) => a.runtimeChannel === runtimeChannel) ?? false;
  }
}
