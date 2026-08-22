import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentShell } from "./StudentShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/home",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("./student-auth-context", () => ({
  useStudentAuth: () => ({
    status: "authenticated",
    context: { studentPublicId: "std_1", tenantPublicId: "sch_1", classPublicId: "cls_1", enrollmentStatus: "ACTIVE", displayAlias: "Mario" },
    logout: vi.fn(),
  }),
}));

/**
 * Pilot Product Experience Remediation Tranche G1 — guards the mission's
 * own "no fake navigation" rule (§42): every nav entry must be a real
 * `<a href>` to a route this mission actually ships, never a decorative
 * label. Each `href` below has a matching `app/w/**` page shipped in the
 * same tranche set (G1-G5).
 */
describe("StudentShell navigation", () => {
  it("renders a real link for every product surface, each pointing at a real route", () => {
    render(
      <StudentShell>
        <div>content</div>
      </StudentShell>,
    );
    const expected: Array<[string, string]> = [
      ["Home", "/w/home"],
      ["La mia classe", "/w/class"],
      ["Il mio percorso", "/w/path"],
      ["Assegnazioni", "/w/assignments"],
      ["Progressi", "/w/progress"],
      ["Profilo", "/w/profile"],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the current page with aria-current", () => {
    render(
      <StudentShell>
        <div>content</div>
      </StudentShell>,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "La mia classe" })).not.toHaveAttribute("aria-current");
  });
});
