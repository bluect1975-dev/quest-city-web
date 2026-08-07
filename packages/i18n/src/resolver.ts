import { DEFAULT_LOCALE, SupportedLocale, isSupportedLocale, isSyntacticallyValidLocale } from "./locale-model";

/**
 * Locale resolution hierarchy (02_34 §3, 07_15_01 v1.2 §15.2-bis): more
 * specific wins, terminating always at DEFAULT_LOCALE. Only schoolLocale has
 * a persisted source in this milestone (tenant.settings_json.locale) --
 * studentLocale/classLocale are optional inputs reserved for a future
 * implementation, never persisted here.
 */
export interface LocaleHierarchyInput {
  studentLocale?: string | null | undefined;
  classLocale?: string | null | undefined;
  schoolLocale?: string | null | undefined;
}

export function resolveLocaleHierarchy(input: LocaleHierarchyInput = {}): SupportedLocale {
  const candidates = [input.studentLocale, input.classLocale, input.schoolLocale];
  for (const candidate of candidates) {
    if (candidate && isSupportedLocale(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_LOCALE;
}

export type PresentationLocaleValidation =
  | { kind: "ABSENT" }
  | { kind: "MALFORMED"; value: string }
  | { kind: "VALID_SUPPORTED"; locale: SupportedLocale }
  | { kind: "VALID_UNSUPPORTED"; value: string };

/**
 * Classifies a raw presentationLocale request value into the three
 * behaviours fixed by 02_34 §4 / 07_15_01 v1.2 §15.2-bis. Pure, no I/O.
 */
export function validatePresentationLocaleInput(
  value: string | null | undefined,
): PresentationLocaleValidation {
  if (value === null || value === undefined || value === "") {
    return { kind: "ABSENT" };
  }
  if (!isSyntacticallyValidLocale(value)) {
    return { kind: "MALFORMED", value };
  }
  if (isSupportedLocale(value)) {
    return { kind: "VALID_SUPPORTED", locale: value };
  }
  return { kind: "VALID_UNSUPPORTED", value };
}

export type ResolvePresentationLocaleResult =
  | { ok: true; resolved: SupportedLocale }
  | { ok: false; reason: "MALFORMED"; value: string };

/**
 * Resolves the effective presentationLocale for a launch-context request.
 * Never influences outcome/scoring/attemptState/completionStatus/mastery/
 * validator/semantic actions -- this function's only output is a locale
 * string, consumed exclusively by the presentation layer.
 */
export function resolvePresentationLocale(
  requested: string | null | undefined,
  hierarchy: LocaleHierarchyInput = {},
): ResolvePresentationLocaleResult {
  const validation = validatePresentationLocaleInput(requested);
  if (validation.kind === "MALFORMED") {
    return { ok: false, reason: "MALFORMED", value: validation.value };
  }
  if (validation.kind === "VALID_SUPPORTED") {
    return { ok: true, resolved: validation.locale };
  }
  // ABSENT or VALID_UNSUPPORTED both fall through to hierarchy resolution.
  return { ok: true, resolved: resolveLocaleHierarchy(hierarchy) };
}
