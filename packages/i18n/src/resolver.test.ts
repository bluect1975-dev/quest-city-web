import { describe, expect, it } from "vitest";
import { resolveLocaleHierarchy, resolvePresentationLocale, validatePresentationLocaleInput } from "./resolver";
import { DEFAULT_LOCALE } from "./locale-model";

describe("resolveLocaleHierarchy", () => {
  it("falls back to defaultLocale when no level is populated", () => {
    expect(resolveLocaleHierarchy({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocaleHierarchy()).toBe(DEFAULT_LOCALE);
  });

  it("uses the school level when only it is populated", () => {
    expect(resolveLocaleHierarchy({ schoolLocale: "it-IT" })).toBe("it-IT");
  });

  it("prefers student over class over school (most specific wins)", () => {
    expect(
      resolveLocaleHierarchy({ studentLocale: "it-IT", classLocale: "it-IT", schoolLocale: "it-IT" }),
    ).toBe("it-IT");
  });

  it("skips a level whose value is an unsupported (planned) locale", () => {
    // en-GB is planned, not supported -- must be skipped, not honored.
    expect(resolveLocaleHierarchy({ studentLocale: "en-GB", schoolLocale: "it-IT" })).toBe("it-IT");
  });

  it("skips null/undefined levels and falls through", () => {
    expect(resolveLocaleHierarchy({ studentLocale: null, classLocale: undefined, schoolLocale: "it-IT" })).toBe(
      "it-IT",
    );
  });

  it("terminates at defaultLocale when every level is an unsupported locale", () => {
    expect(
      resolveLocaleHierarchy({ studentLocale: "fr-FR", classLocale: "de-DE", schoolLocale: "es-ES" }),
    ).toBe(DEFAULT_LOCALE);
  });
});

describe("validatePresentationLocaleInput", () => {
  it("classifies an absent value", () => {
    expect(validatePresentationLocaleInput(undefined)).toEqual({ kind: "ABSENT" });
    expect(validatePresentationLocaleInput(null)).toEqual({ kind: "ABSENT" });
    expect(validatePresentationLocaleInput("")).toEqual({ kind: "ABSENT" });
  });

  it("classifies a syntactically malformed value", () => {
    expect(validatePresentationLocaleInput("not a locale!!")).toEqual({
      kind: "MALFORMED",
      value: "not a locale!!",
    });
    expect(validatePresentationLocaleInput("1")).toEqual({ kind: "MALFORMED", value: "1" });
  });

  it("classifies a syntactically valid, supported value", () => {
    expect(validatePresentationLocaleInput("it-IT")).toEqual({ kind: "VALID_SUPPORTED", locale: "it-IT" });
  });

  it("classifies a syntactically valid, unsupported (planned) value", () => {
    expect(validatePresentationLocaleInput("en-GB")).toEqual({ kind: "VALID_UNSUPPORTED", value: "en-GB" });
  });

  it("classifies a syntactically valid, entirely unknown value the same as unsupported", () => {
    // zz-ZZ matches the restricted BCP-47 shape but is neither supported nor planned.
    expect(validatePresentationLocaleInput("zz-ZZ")).toEqual({ kind: "VALID_UNSUPPORTED", value: "zz-ZZ" });
  });
});

describe("resolvePresentationLocale", () => {
  it("resolves via hierarchy when the request omits presentationLocale", () => {
    expect(resolvePresentationLocale(undefined, { schoolLocale: "it-IT" })).toEqual({
      ok: true,
      resolved: "it-IT",
    });
  });

  it("honors a valid, supported requested locale directly", () => {
    expect(resolvePresentationLocale("it-IT", {})).toEqual({ ok: true, resolved: "it-IT" });
  });

  it("falls back silently (never an error) for a valid but unsupported requested locale", () => {
    expect(resolvePresentationLocale("en-GB", { schoolLocale: "it-IT" })).toEqual({
      ok: true,
      resolved: "it-IT",
    });
  });

  it("rejects a malformed requested locale, never treating it as absent", () => {
    const result = resolvePresentationLocale("!!!", {});
    expect(result).toEqual({ ok: false, reason: "MALFORMED", value: "!!!" });
  });

  it("always terminates at defaultLocale when the hierarchy is fully empty", () => {
    expect(resolvePresentationLocale(undefined, {})).toEqual({ ok: true, resolved: DEFAULT_LOCALE });
    expect(resolvePresentationLocale("de-DE", {})).toEqual({ ok: true, resolved: DEFAULT_LOCALE });
  });
});
