import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AssignmentsPage from "./page";

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

describe("AssignmentsPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyAssignments.mockReset();
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<AssignmentsPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("renders every real assignment with a working link, not just the home page's truncated view", async () => {
    getMyAssignments.mockResolvedValue([
      { assignmentId: "asn-1", contentBundleId: "bnd-1", title: "Compito A", completionStatus: "NOT_STARTED", latestAttemptId: null, dueAt: null },
      { assignmentId: "asn-2", contentBundleId: "bnd-2", title: "Compito B", completionStatus: "COMPLETED", latestAttemptId: "att-1", dueAt: null },
    ]);
    render(<AssignmentsPage />);
    expect(await screen.findByText("Compito A")).toBeInTheDocument();
    expect(screen.getByText("Compito B")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inizia" })).toHaveAttribute("href", "/w/activity/asn-1");
    // UAT-RC4-STUDENT-REVIEW-COMPLETED-ATTEMPT-01: a completed assignment opens the
    // read-only result/review page for its real finishing attempt, never the live launch flow.
    expect(screen.getByRole("link", { name: "Rivedi" })).toHaveAttribute("href", "/w/result/att-1");
  });

  it("shows a real empty state, not an error, when there are no assignments", async () => {
    getMyAssignments.mockResolvedValue([]);
    render(<AssignmentsPage />);
    expect(await screen.findByText("Nessuna assegnazione al momento")).toBeInTheDocument();
  });
});
