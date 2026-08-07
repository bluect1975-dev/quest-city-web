export type Catalog = { readonly [key: string]: string | Catalog };

export type MissingKeyStrategy = "throw" | "returnKey";

export interface TranslateOptions {
  params?: Record<string, string | number>;
  onMissingKey?: MissingKeyStrategy;
}

function getByPath(catalog: Catalog, key: string): string | undefined {
  const segments = key.split(".");
  let cursor: string | Catalog | undefined = catalog;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Pure translation lookup: t(catalog, "lesson.start"). Missing-key
 * behaviour is explicit and caller-controlled (defaults to "throw" outside
 * production, "returnKey" in production, so a missing key never renders as
 * a blank string to a student but is loud during development).
 */
export function t(catalog: Catalog, key: string, options: TranslateOptions = {}): string {
  const raw = getByPath(catalog, key);
  if (raw === undefined) {
    const strategy: MissingKeyStrategy =
      options.onMissingKey ?? (process.env.NODE_ENV === "production" ? "returnKey" : "throw");
    if (strategy === "throw") {
      throw new Error(`i18n: missing translation key "${key}"`);
    }
    return key;
  }
  return options.params ? interpolate(raw, options.params) : raw;
}

/**
 * Maps an ErrorEnvelope.code to a localized, student-facing message via the
 * errors.json catalog. ErrorEnvelope.message is never rendered directly by
 * the UI (02_34 §6) -- code is the only stable, language-independent
 * identifier a client should key off of.
 */
export function translateErrorCode(errorsCatalog: Catalog, code: string): string {
  return t(errorsCatalog, code, { onMissingKey: "returnKey" });
}
