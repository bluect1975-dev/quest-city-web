import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressPage from "./page";

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

const getProgressSummary = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getProgressSummary: (...args: unknown[]) => getProgressSummary(...args),
}));

describe("ProgressPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getProgressSummary.mockReset();
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<ProgressPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("shows a real empty state when nothing has been attempted yet (never a fabricated 0%)", async () => {
    getProgressSummary.mockResolvedValue({
      studentPublicId: "std_1",
      aggregate: { totalAttempts: 0, byAttemptState: {}, byCompletionStatus: {} },
    });
    render(<ProgressPage />);
    expect(await screen.findByText("Nessun progresso ancora registrato")).toBeInTheDocument();
  });

  it("shows the real aggregate total and per-status breakdown", async () => {
    getProgressSummary.mockResolvedValue({
      studentPublicId: "std_1",
      aggregate: {
        totalAttempts: 5,
        byAttemptState: { COMPLETED: 3, IN_PROGRESS: 2 },
        byCompletionStatus: { COMPLETED: 3, IN_PROGRESS: 1, NOT_STARTED: 0 },
      },
    });
    render(<ProgressPage />);
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByText("Completata")).toBeInTheDocument();
    expect(screen.getByText("In corso")).toBeInTheDocument();
    expect(screen.queryByText("Da iniziare")).not.toBeInTheDocument();
  });
});
