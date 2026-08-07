/**
 * Canonical locale model (02_34 v1.0, quest-city-roblox).
 * supportedLocales has a published catalog under src/locales/; plannedLocales
 * are registered for future work but MUST NOT be reported as supported by
 * the runtime (02_34 §2.2-2.3).
 */

export const DEFAULT_LOCALE = "it-IT" as const;

export const SUPPORTED_LOCALES = ["it-IT"] as const;

export const PLANNED_LOCALES = ["en-GB", "en-US", "es-ES", "fr-FR", "de-DE"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type PlannedLocale = (typeof PLANNED_LOCALES)[number];

/**
 * Restricted BCP-47-shaped syntax check (02_34 §2, contracts v1.5
 * PresentationLocaleInput) -- syntax only, not the full BCP-47 grammar, and
 * NOT a support check. A value can match this pattern and still be
 * unsupported (see resolvePresentationLocale).
 */
const BCP47_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export function isSyntacticallyValidLocale(value: string): boolean {
  return BCP47_PATTERN.test(value);
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isPlannedLocale(value: string): value is PlannedLocale {
  return (PLANNED_LOCALES as readonly string[]).includes(value);
}
