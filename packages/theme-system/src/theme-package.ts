/**
 * Theme Package contract (07_01_02 §6). A Theme Package binds semantic roles
 * to concrete tokens/assets and must never be imported by a validator or
 * change an outcome, difficulty, timer, score or mastery (07_01_02 §5).
 */
export interface ThemePackage {
  themeId: string;
  themeVersion: string;
  designTokens: Record<string, string>;
  isAlwaysAvailableFallback: boolean;
}

/**
 * QC-THEME-CORE (07_01_02 §6): minimal, accessible, no narrative — must
 * always be resolvable so a missing/incompatible theme never blocks an
 * activity from completing.
 */
export const QC_THEME_CORE: ThemePackage = {
  themeId: "QC-THEME-CORE",
  themeVersion: "0.1.0",
  designTokens: {
    "color-background": "#ffffff",
    "color-foreground": "#111111",
    "color-accent": "#1a5fb4",
    "font-family-base": "system-ui, sans-serif",
  },
  isAlwaysAvailableFallback: true,
};

export function resolveTheme(
  themeId: string,
  registry: ThemePackage[] = [QC_THEME_CORE],
): ThemePackage {
  return registry.find((t) => t.themeId === themeId) ?? QC_THEME_CORE;
}
