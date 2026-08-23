import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultPage from "./page";

const routerReplace = vi.fn();
let authStatus: "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated" = "authenticated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useParams: () => ({ attemptId: "att-real-1" }),
}));

vi.mock("../../../../lib/student-auth-context", () => ({
  useStudentAuth: () => ({ status: authStatus }),
}));

const getAttempt = vi.fn();
const getMyFeedback = vi.fn();

vi.mock("../../../../lib/student-api-client", () => ({
  getAttempt: (...args: unknown[]) => getAttempt(...args),
  getMyFeedback: (...args: unknown[]) => getMyFeedback(...args),
}));

describe("ResultPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getAttempt.mockReset();
    getMyFeedback.mockReset();
    getMyFeedback.mockResolvedValue([]);
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<ResultPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("fetches the attempt by the real attemptId from the route and shows the real CORRECT outcome", async () => {
    getAttempt.mockResolvedValue({
      attemptId: "att-real-1",
      assignmentId: "asn-1",
      activityId: "act-1",
      attemptState: "COMPLETED",
      completionStatus: "CONSOLIDATED",
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: "2026-08-09T10:05:00.000Z",
      outcome: { correctness: "CORRECT", score: 1 },
    });
    render(<ResultPage />);
    expect(await screen.findByText("Corretto")).toBeInTheDocument();
    expect(getAttempt).toHaveBeenCalledWith("att-real-1");
    // The raw attemptState enum ("COMPLETED") must never reach the page as text —
    // only its friendly, localized label.
    expect(screen.getByText("Completato")).toBeInTheDocument();
    expect(screen.queryByText(/COMPLETED/)).not.toBeInTheDocument();
  });

  it("shows a pending-consolidation message when the attempt is not yet CONSOLIDATED", async () => {
    getAttempt.mockResolvedValue({
      attemptId: "att-real-1",
      assignmentId: "asn-1",
      activityId: "act-1",
      attemptState: "COMPLETION_SUBMITTED",
      completionStatus: "ACCEPTED_NOT_CONSOLIDATED",
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: null,
      outcome: null,
    });
    render(<ResultPage />);
    expect(await screen.findByText("Il risultato è in fase di verifica.")).toBeInTheDocument();
  });

  it("shows published docente feedback for this attempt (UAT-RC4-STUDENT-FEEDBACK-VISIBILITY-01), filtered from the student's full feedback list", async () => {
    getAttempt.mockResolvedValue({
      attemptId: "att-real-1",
      assignmentId: "asn-1",
      activityId: "act-1",
      attemptState: "COMPLETED",
      completionStatus: "CONSOLIDATED",
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: "2026-08-09T10:05:00.000Z",
      outcome: { correctness: "CORRECT", score: 1 },
    });
    getMyFeedback.mockResolvedValue([
      {
        feedbackId: "fb-1",
        learningAttemptId: "att-real-1",
        assignmentTitle: "Balance Machine Challenge",
        freeText: "Ottimo lavoro sull'equilibrio!",
        publishedAt: "2026-08-23T16:00:00.000Z",
      },
      // A different attempt's feedback must never leak onto this page.
      {
        feedbackId: "fb-2",
        learningAttemptId: "att-other",
        assignmentTitle: "Un'altra attività",
        freeText: "Non pertinente qui.",
        publishedAt: "2026-08-23T16:00:00.000Z",
      },
    ]);
    render(<ResultPage />);
    expect(await screen.findByText("Ottimo lavoro sull'equilibrio!")).toBeInTheDocument();
    expect(screen.queryByText("Non pertinente qui.")).not.toBeInTheDocument();
  });

  it("never shows the feedback section when the student has no published feedback for this attempt", async () => {
    getAttempt.mockResolvedValue({
      attemptId: "att-real-1",
      assignmentId: "asn-1",
      activityId: "act-1",
      attemptState: "COMPLETED",
      completionStatus: "CONSOLIDATED",
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: "2026-08-09T10:05:00.000Z",
      outcome: { correctness: "CORRECT", score: 1 },
    });
    render(<ResultPage />);
    await screen.findByText("Corretto");
    expect(screen.queryByText("Feedback del tuo insegnante")).not.toBeInTheDocument();
  });
});
