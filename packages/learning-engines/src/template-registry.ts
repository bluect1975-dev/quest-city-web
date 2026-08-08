/**
 * Template Registry runtime (02_36 §6.1, template-contract.schema.json).
 * A TEMPLATE is a reusable pedagogical/configuration pattern layered above
 * exactly one canonical engine — never a substitute for one (02_36 §6).
 * Keyed by `templateId` + `templateVersion`; empty by default, same
 * Registry Update Gate posture as EngineRegistry (no production template
 * registered at R3B — see 02_36 §5.4 applied by analogy).
 */
import type { AxisAValue, TemplateContractEntry } from "./types";

function key(templateId: string, templateVersion: string): string {
  return `${templateId}@${templateVersion}`;
}

export class TemplateAlreadyRegisteredError extends Error {
  constructor(templateId: string, templateVersion: string) {
    super(`Template already registered: ${templateId}@${templateVersion}`);
    this.name = "TemplateAlreadyRegisteredError";
  }
}

export class TemplateRegistry {
  private readonly templates = new Map<string, TemplateContractEntry>();

  register(entry: TemplateContractEntry): void {
    const k = key(entry.templateId, entry.templateVersion);
    if (this.templates.has(k)) {
      throw new TemplateAlreadyRegisteredError(entry.templateId, entry.templateVersion);
    }
    this.templates.set(k, entry);
  }

  get(templateId: string, templateVersion: string): TemplateContractEntry | undefined {
    return this.templates.get(key(templateId, templateVersion));
  }

  list(): TemplateContractEntry[] {
    return [...this.templates.values()];
  }

  /** Templates layered above the given canonical engine. */
  findByCanonicalEngineId(canonicalEngineId: string): TemplateContractEntry[] {
    return this.list().filter((t) => t.canonicalEngineId === canonicalEngineId);
  }

  /** Templates whose declared requiredCapabilities cover every requested capability. */
  findByCapabilities(requiredCapabilities: readonly AxisAValue[]): TemplateContractEntry[] {
    return this.list().filter((t) =>
      requiredCapabilities.every((c) => t.requiredCapabilities.includes(c)),
    );
  }
}
