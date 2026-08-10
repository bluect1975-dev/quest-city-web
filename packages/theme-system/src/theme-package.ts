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
  registry: ThemePackage[] = [QC_THEME_CORE, QC_THEME_ACADEMY],
): ThemePackage {
  return registry.find((t) => t.themeId === themeId) ?? QC_THEME_CORE;
}

/**
 * `QC-THEME-ACADEMY` (M06 Web Full Vertical Slice Tranche 5, `07_26 v1.1`
 * §13/§17.3; direction from `07_14 v1.0` §2: "fantasy accademico
 * contemporaneo, luminoso e sobrio"). Design tokens only — the semantic
 * roles this theme actually resolves to real assets are registered
 * separately in `sprite-cook-batch.ts`'s manifest, never hardcoded here
 * (`07_14` §18: "nessuna lesson può dipendere direttamente da un nome
 * file SpriteCook").
 */
export const QC_THEME_ACADEMY: ThemePackage = {
  themeId: "QC-THEME-ACADEMY",
  themeVersion: "0.1.0",
  designTokens: {
    "color-background": "#f7fbff",
    "color-foreground": "#1c2a3a",
    "color-accent": "#1a5fb4",
    "font-family-base": "system-ui, sans-serif",
  },
  isAlwaysAvailableFallback: false,
};
