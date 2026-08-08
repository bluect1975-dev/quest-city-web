import { EngineRuntimeRegistry } from "./engine-runtime-registry";
import { buildBalanceMachineRegistryEntry, createBalanceMachineEngine } from "./engines/balance-machine-engine";
import { buildDragAndDropRegistryEntry, createDragAndDropEngine } from "./engines/drag-and-drop-engine";
import { buildQuickQuestionRegistryEntry, createQuickQuestionEngine } from "./engines/quick-question-engine";
import type { EngineRegistryEntry } from "./types";

/**
 * The 3 R3C.1 P0 engines, assembled in one place so both the attempts
 * package (server-side dispatch) and student-web (client rendering) build
 * the exact same runtime registry rather than each hand-assembling it.
 */
export function createDefaultEngineRuntimeRegistry(): EngineRuntimeRegistry {
  const registry = new EngineRuntimeRegistry();
  registry.register(createBalanceMachineEngine());
  registry.register(createQuickQuestionEngine());
  registry.register(createDragAndDropEngine());
  return registry;
}

/** Governance/publication-metadata entries for the same 3 engines (registry.ts's `EngineRegistry`, distinct concern — see engine-runtime-registry.ts). */
export function createP0EngineRegistryEntries(): EngineRegistryEntry[] {
  return [buildBalanceMachineRegistryEntry(), buildQuickQuestionRegistryEntry(), buildDragAndDropRegistryEntry()];
}
