import { afterEach, describe, expect, it, vi } from "vitest";

// Regression test for the Tranche F pilot-hardening finding: constructing
// an Ajv instance at module import time made `@quest-city-web/content-schema`
// crash every `student-web` page under this repo's real CSP (`script-src`
// without `unsafe-eval`) the moment it was transitively bundled through
// `@quest-city-web/content-runtime`'s barrel export — even though no
// client code ever calls `validateAgainst`. This test asserts the Ajv
// constructor is never invoked merely by importing the module, only by a
// real call to `validateAgainst`, and only once (singleton reuse).
describe("validate.ts lazy Ajv construction (Tranche F CSP/EvalError regression)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("ajv/dist/2020.js");
    vi.doUnmock("ajv-formats");
  });

  it("does not construct an Ajv instance on import — only on first validateAgainst call, and only once", async () => {
    const constructorSpy = vi.fn();

    vi.resetModules();
    vi.doMock("ajv/dist/2020.js", () => {
      class FakeAjv {
        constructor(options: unknown) {
          constructorSpy(options);
        }
        addKeyword() {
          return this;
        }
        addFormat() {
          return this;
        }
        addSchema() {
          return this;
        }
        getSchema() {
          return Object.assign(() => true, { errors: null });
        }
      }
      return { default: FakeAjv };
    });
    vi.doMock("ajv-formats", () => ({ default: () => {} }));

    const { validateAgainst } = await import("./validate");

    expect(constructorSpy).not.toHaveBeenCalled();

    validateAgainst("webContentBundleManifest", {});
    expect(constructorSpy).toHaveBeenCalledTimes(1);

    validateAgainst("webContentBundleManifest", {});
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });
});
