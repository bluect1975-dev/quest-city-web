import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MyPathPage from "./page";

const routerReplace = vi.fn();
let authStatus: "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated" = "authenticated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("../../../lib/student-auth-context", () => ({
  useStudentAuth: () => ({
    status: authStatus,
    context: { studentPublicId: "std_1", tenantPublicId: "sch_1", classPublicId: "cls_1", enrollmentStatus: "ACTIVE", displayAlias: "Mario" },
    logout: vi.fn(),
  }),
}));

const getMyAssignments = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getMyAssignments: (...args: unknown[]) => getMyAssignments(...args),
}));

describe("MyPathPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyAssignments.mockReset();
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<MyPathPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("renders the real ordered assignment sequence as path steps", async () => {
    getMyAssignments.mockResolvedValue([
      { assignmentId: "asn-1", contentBundleId: "bnd-1", title: "Tappa 1", completionStatus: "COMPLETED", latestAttemptId: null, dueAt: null },
      { assignmentId: "asn-2", contentBundleId: "bnd-2", title: "Tappa 2", completionStatus: "IN_PROGRESS", latestAttemptId: null, dueAt: null },
    ]);
    render(<MyPathPage />);
    expect(await screen.findByText("Tappa 1")).toBeInTheDocument();
    expect(screen.getByText("Tappa 2")).toBeInTheDocument();
  });

  it("shows a real empty state when the student has no assignments yet", async () => {
    getMyAssignments.mockResolvedValue([]);
    render(<MyPathPage />);
    expect(await screen.findByText("Il tuo percorso non è ancora disponibile")).toBeInTheDocument();
  });
});
