/**
 * RuntimeCapabilityResolver (07_15_01 v1.1 §4, §14): consumes the
 * capability/adapter model of 07_08 §9-10 without redefining it. Resolves
 * whether a compatible Presentation Adapter exists for a runtime given the
 * activity's required capabilities — genuinely uses all three inputs
 * (`runtimeChannel`, `requestedCapabilities`, `availableAdapters`), filters
 * by runtime first (an adapter for the wrong runtime is never returned,
 * regardless of its capabilities), then by full capability coverage.
 */
export interface PresentationAdapterRef {
  adapterId: string;
  adapterVersion: string;
  supportedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  supportedCapabilities: string[];
}

export interface RuntimeCapabilityResolveInput {
  runtimeChannel: "WEB" | "ROBLOX";
  requestedCapabilities: string[];
  availableAdapters: PresentationAdapterRef[];
}

export type RuntimeCapabilityResolveResult =
  | { compatible: true; adapter: PresentationAdapterRef }
  | { compatible: false; reason: "CAPABILITY_MISSING" | "PRESENTATION_ADAPTER_UNAVAILABLE" };

export class RuntimeCapabilityResolver {
  resolve(input: RuntimeCapabilityResolveInput): RuntimeCapabilityResolveResult {
    const runtimeAdapters = input.availableAdapters.filter((adapter) =>
      adapter.supportedRuntimeChannels.includes(input.runtimeChannel),
    );
    if (runtimeAdapters.length === 0) {
      // No adapter is usable at all for the requested runtime — whether
      // because none exist, or the only ones available target a different
      // runtime — is "no usable adapter" either way (07_15_01 v1.1 §14).
      return { compatible: false, reason: "PRESENTATION_ADAPTER_UNAVAILABLE" };
    }
    const compatibleAdapter = runtimeAdapters.find((adapter) =>
      input.requestedCapabilities.every((cap) => adapter.supportedCapabilities.includes(cap)),
    );
    if (compatibleAdapter) {
      return { compatible: true, adapter: compatibleAdapter };
    }
    // At least one adapter exists for the runtime, but none covers every
    // required capability -> the gap is capability coverage, not adapter
    // availability (07_15_01 v1.1 §14 distinguishes the two error codes).
    return { compatible: false, reason: "CAPABILITY_MISSING" };
  }
}
