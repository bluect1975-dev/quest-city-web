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

  it("headline counts real completed activities only, never raw attempts (UAT-RC4-STUDENT-PROGRESS-ACTIVITY-COUNT-01)", async () => {
    getProgressSummary.mockResolvedValue({
      studentPublicId: "std_1",
      aggregate: {
        totalAttempts: 4,
        // Mirrors the real UAT dataset: 1 real COMPLETED activity, 3 empty
        // CREATED attempts that were never played — those must never be
        // counted as "attività svolte".
        byAttemptState: { COMPLETED: 1, CREATED: 3 },
        byCompletionStatus: { CONSOLIDATED: 1 },
      },
    });
    render(<ProgressPage />);
    // Headline "Attività completate" is 1, not the raw total of 4. The label
    // now also appears as the ProgressRing's caption, so disambiguate to the
    // stats-card instance specifically.
    const completedLabels = await screen.findAllByText("Attività completate");
    expect(completedLabels.length).toBeGreaterThan(0);
    const completedCard = completedLabels.map((el) => el.closest(".qc-stats-card")).find(Boolean);
    expect(completedCard).toHaveTextContent("1");
    // The breakdown reconciles exactly to totalAttempts, with no raw enum leaking.
    expect(screen.getByText("Completate")).toBeInTheDocument();
    expect(screen.getByText("Non avviati")).toBeInTheDocument();
    expect(screen.queryByText("CREATED")).not.toBeInTheDocument();
    expect(screen.queryByText("CONSOLIDATED")).not.toBeInTheDocument();
    // The raw "all states" total is still disclosed, but as an explicit secondary figure.
    expect(screen.getByText(/Tentativi totali \(tutti gli stati\): 4/)).toBeInTheDocument();
  });

  it("shows the in-progress count separately from completed, and an empty verification section when nothing is completed yet", async () => {
    getProgressSummary.mockResolvedValue({
      studentPublicId: "std_1",
      aggregate: {
        totalAttempts: 2,
        byAttemptState: { IN_PROGRESS: 1, COMPLETION_SUBMITTED: 1 },
        byCompletionStatus: {},
      },
    });
    render(<ProgressPage />);
    // "In corso" appears twice by design: the headline stats-card (IN_PROGRESS +
    // COMPLETION_SUBMITTED combined) and the reconciled per-state breakdown's own IN_PROGRESS row.
    const inProgressMatches = await screen.findAllByText("In corso");
    const inProgressCard = inProgressMatches.map((el) => el.closest(".qc-stats-card")).find(Boolean);
    expect(inProgressCard).toHaveTextContent("2");
    expect(screen.queryByText("Dettaglio verifica delle attività completate")).not.toBeInTheDocument();
  });
});
