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

vi.mock("../../../../lib/student-api-client", () => ({
  getAttempt: (...args: unknown[]) => getAttempt(...args),
}));

describe("ResultPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getAttempt.mockReset();
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
});
