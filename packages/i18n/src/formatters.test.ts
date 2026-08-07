import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, formatPercent } from "./formatters";

describe("formatters (it-IT)", () => {
  it("formats a date using Intl.DateTimeFormat", () => {
    const result = formatDate(new Date("2026-08-07T00:00:00Z"), "it-IT");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats a number using Intl.NumberFormat with locale decimal separator", () => {
    expect(formatNumber(1234.5, "it-IT")).toBe(new Intl.NumberFormat("it-IT").format(1234.5));
  });

  it("formats a percentage", () => {
    expect(formatPercent(0.86, "it-IT")).toBe(new Intl.NumberFormat("it-IT", { style: "percent" }).format(0.86));
  });

  it("respects a custom fraction-digit count for percentages", () => {
    expect(formatPercent(0.8625, "it-IT", 2)).toBe(
      new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        0.8625,
      ),
    );
  });
});
