/**
 * Theme-level reduced motion (M06 Web Full Vertical Slice Tranche 5,
 * `07_26 v1.1` §13/§17). Distinct from the per-engine `reducedMotion`
 * capability flag already exposed by individual Learning Engines
 * (`BalanceMachineEngine` etc.) — this profile applies uniformly to the
 * theme/scene presentation layer (scene backgrounds, character idle
 * loops, transitions), consumed by every stage's presentation, not only
 * engine-hosted ones (`07_14` §11: "Ogni animazione essenziale deve avere
 * stato statico equivalente. Loop ambientali sono disattivati; camera
 * movement e parallasse vengono rimossi; feedback resta leggibile tramite
 * testo, forma e contrasto.").
 */
export type MotionProfile = "STANDARD" | "REDUCED";

/** Pure mapping from the user's `prefers-reduced-motion` preference to the theme-level profile — no DOM/browser access here, kept environment-agnostic for reuse in tests and non-browser callers. */
export function pickMotionProfile(prefersReducedMotion: boolean): MotionProfile {
  return prefersReducedMotion ? "REDUCED" : "STANDARD";
}
