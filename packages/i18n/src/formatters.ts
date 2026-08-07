import type { SupportedLocale } from "./locale-model";

/**
 * Thin Intl wrappers, foundation only (02_34 §3F). No currency formatter:
 * no monetary value exists anywhere in the current domain model, so adding
 * one now would be an artificial use case.
 */

export function formatDate(date: Date, locale: SupportedLocale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatNumber(value: number, locale: SupportedLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(value: number, locale: SupportedLocale, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
