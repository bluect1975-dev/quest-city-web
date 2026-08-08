/**
 * Capability Contract consumer (02_36 §4, capability-contract.schema.json,
 * D8 finalized). Axis A (interaction/activity, owned by 07_08 §9) and
 * Axis B (device/runtime presentation, owned by capability-profile.schema.json)
 * are two independent axes, never merged into one enum or one comparison.
 */
import { AXIS_A_VALUES, type AxisAValue, type AxisBProfile } from "./types";

const AXIS_A_SET: ReadonlySet<string> = new Set(AXIS_A_VALUES);

export function isAxisAValue(value: string): value is AxisAValue {
  return AXIS_A_SET.has(value);
}

/** Axis A: does the declared capability set cover every requested capability? Pure set containment, no Axis B involved. */
export function coversRequiredCapabilities(
  requested: readonly AxisAValue[],
  declared: { required: readonly AxisAValue[]; optional: readonly AxisAValue[] },
): boolean {
  const available = new Set<AxisAValue>([...declared.required, ...declared.optional]);
  return requested.every((c) => available.has(c));
}

/**
 * Axis B: does a device/runtime profile satisfy a presentation adapter's
 * declared needs? Kept as a narrow, explicit comparison (never merged with
 * Axis A) — an adapter's needs are expressed the same shape as
 * AxisBProfile, minus profileId, since an adapter declares requirements,
 * not an identity.
 */
export interface AxisBRequirement {
  input?: AxisBProfile["input"];
  rendering?: AxisBProfile["rendering"];
  reducedMotionRequired?: boolean;
}

export function satisfiesAxisBRequirement(
  profile: AxisBProfile,
  requirement: AxisBRequirement,
): boolean {
  if (requirement.input && !requirement.input.some((i) => profile.input.includes(i))) {
    return false;
  }
  if (requirement.rendering && !requirement.rendering.some((r) => profile.rendering.includes(r))) {
    return false;
  }
  if (requirement.reducedMotionRequired && profile.reducedMotion !== true) {
    return false;
  }
  return true;
}
