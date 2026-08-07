import { describe, expect, it } from "vitest";
import { t, translateErrorCode, type Catalog } from "./translate";

const catalog: Catalog = {
  greeting: "Ciao {name}",
  nested: {
    key: "Valore annidato",
  },
};

describe("t()", () => {
  it("returns the translated string for a found top-level key", () => {
    expect(t(catalog, "nested.key", { onMissingKey: "throw" })).toBe("Valore annidato");
  });

  it("resolves a dot-path nested key", () => {
    expect(t({ a: { b: { c: "profondo" } } }, "a.b.c", { onMissingKey: "throw" })).toBe("profondo");
  });

  it("interpolates {param} placeholders", () => {
    expect(t(catalog, "greeting", { params: { name: "Ada" }, onMissingKey: "throw" })).toBe("Ciao Ada");
  });

  it("leaves an unmatched placeholder untouched when no param is supplied for it", () => {
    expect(t(catalog, "greeting", { params: {}, onMissingKey: "throw" })).toBe("Ciao {name}");
  });

  it("throws on a missing key when onMissingKey is 'throw'", () => {
    expect(() => t(catalog, "does.not.exist", { onMissingKey: "throw" })).toThrow(/missing translation key/);
  });

  it("returns the key itself on a missing key when onMissingKey is 'returnKey'", () => {
    expect(t(catalog, "does.not.exist", { onMissingKey: "returnKey" })).toBe("does.not.exist");
  });
});

describe("translateErrorCode", () => {
  const errors: Catalog = { KNOWN_CODE: "Messaggio noto." };

  it("maps a known error code to its localized message", () => {
    expect(translateErrorCode(errors, "KNOWN_CODE")).toBe("Messaggio noto.");
  });

  it("never throws on an unknown code -- returns the code itself as a safe fallback", () => {
    expect(translateErrorCode(errors, "SOME_UNMAPPED_CODE")).toBe("SOME_UNMAPPED_CODE");
  });
});
