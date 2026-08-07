import { describe, expect, it } from "vitest";
import { RuntimeCapabilityResolver } from "./runtime-capability-resolver";

describe("RuntimeCapabilityResolver", () => {
  const resolver = new RuntimeCapabilityResolver();

  it("resolves a compatible adapter when one covers every required capability", () => {
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["DRAG_DROP", "TEXT_INPUT"],
      availableAdapters: [
        {
          adapterId: "WEB-MAT-BALANCE",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["WEB"],
          supportedCapabilities: ["DRAG_DROP", "TEXT_INPUT", "NUMERIC_INPUT"],
        },
      ],
    });
    expect(result.compatible).toBe(true);
    if (result.compatible) {
      expect(result.adapter.adapterId).toBe("WEB-MAT-BALANCE");
    }
  });

  it("returns PRESENTATION_ADAPTER_UNAVAILABLE when no adapter exists at all", () => {
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["DRAG_DROP"],
      availableAdapters: [],
    });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toBe("PRESENTATION_ADAPTER_UNAVAILABLE");
    }
  });

  it("returns PRESENTATION_ADAPTER_UNAVAILABLE when adapters exist only for a different runtime", () => {
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: [],
      availableAdapters: [
        {
          adapterId: "ROBLOX-MAT-BALANCE",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["ROBLOX"],
          supportedCapabilities: ["DRAG_DROP"],
        },
      ],
    });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toBe("PRESENTATION_ADAPTER_UNAVAILABLE");
    }
  });

  it("returns CAPABILITY_MISSING when adapters exist but none cover every required capability", () => {
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["VOICE_INPUT"],
      availableAdapters: [
        {
          adapterId: "WEB-MAT-BALANCE",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["WEB"],
          supportedCapabilities: ["DRAG_DROP"],
        },
      ],
    });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toBe("CAPABILITY_MISSING");
    }
  });

  it("picks the compatible adapter among several covering different runtimes/capabilities", () => {
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["DRAG_DROP"],
      availableAdapters: [
        {
          adapterId: "ROBLOX-FULL",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["ROBLOX"],
          supportedCapabilities: ["DRAG_DROP"],
        },
        {
          adapterId: "WEB-PARTIAL",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["WEB"],
          supportedCapabilities: ["TEXT_INPUT"],
        },
        {
          adapterId: "WEB-FULL",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["WEB"],
          supportedCapabilities: ["DRAG_DROP"],
        },
      ],
    });
    expect(result.compatible).toBe(true);
    if (result.compatible) {
      expect(result.adapter.adapterId).toBe("WEB-FULL");
    }
  });
});
