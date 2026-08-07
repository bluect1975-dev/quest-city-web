import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StaffAttemptReviewPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ attemptId: "attempt-1" }),
  useSearchParams: () => new URLSearchParams("reviewItemId=review-1"),
}));

vi.mock("../../../../../lib/staff-auth-context", () => ({
  useStaffAuth: () => ({
    status: "authenticated",
    context: { staffAccountId: "staff-1", tenantId: "tenant-1", role: "SCHOOL_ADMIN", classScope: null },
    csrfToken: "csrf-token-123",
  }),
}));

const getAttemptReviewDetail = vi.fn();
const createTeacherFeedback = vi.fn();

vi.mock("../../../../../lib/staff-api-client", () => ({
  getAttemptReviewDetail: (...args: unknown[]) => getAttemptReviewDetail(...args),
  createTeacherFeedback: (...args: unknown[]) => createTeacherFeedback(...args),
  publishTeacherFeedback: vi.fn(),
  revokeTeacherFeedback: vi.fn(),
  createRecoveryAssignment: vi.fn(),
}));

const ATTEMPT_REVIEW_DETAIL = {
  attemptId: "attempt-1",
  studentAnswer: { value: "42" },
  semanticActions: [],
  hints: [],
  validatorOutcome: null,
  proposedAiFeedback: null,
  previousAttempts: [],
  relatedCompetencies: [],
  runtimeChannel: "WEB" as const,
  reconciliationStatus: null,
};

describe("StaffAttemptReviewPage feedback form", () => {
  beforeEach(() => {
    getAttemptReviewDetail.mockReset();
    createTeacherFeedback.mockReset();
    getAttemptReviewDetail.mockResolvedValue(ATTEMPT_REVIEW_DETAIL);
  });

  it("submits the feedback form and calls createTeacherFeedback with the entered structured/free text and origin review item", async () => {
    createTeacherFeedback.mockResolvedValue({
      id: "feedback-1",
      tenantId: "tenant-1",
      classId: "class-1",
      studentProfileId: "student-1",
      learningAttemptId: "attempt-1",
      authorStaffId: "staff-1",
      structuredFeedback: { esito: "da rivedere" },
      freeText: "Ottimo lavoro",
      publicationStatus: "DRAFT",
      deliveryStatus: "NOT_APPLICABLE",
      originReviewQueueItemId: "review-1",
      recoveryAssignmentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      publishedAt: null,
      revokedAt: null,
      version: 1,
    });

    render(<StaffAttemptReviewPage />);

    await screen.findByText("Nuovo feedback");

    const structuredField = screen.getByLabelText("Feedback strutturato (JSON)");
    fireEvent.change(structuredField, { target: { value: '{"esito":"da rivedere"}' } });
    const freeTextField = screen.getByLabelText("Nota libera (facoltativa, solo per la dashboard)");
    fireEvent.change(freeTextField, { target: { value: "Ottimo lavoro" } });

    fireEvent.click(screen.getByRole("button", { name: "Crea bozza feedback" }));

    await waitFor(() =>
      expect(createTeacherFeedback).toHaveBeenCalledWith({
        attemptId: "attempt-1",
        structuredFeedback: { esito: "da rivedere" },
        freeText: "Ottimo lavoro",
        originReviewQueueItemId: "review-1",
        csrfToken: "csrf-token-123",
      }),
    );

    expect(await screen.findByText("Bozza")).toBeInTheDocument();
  });

  it("shows a validation error and does not call createTeacherFeedback when the structured feedback is invalid JSON", async () => {
    render(<StaffAttemptReviewPage />);

    await screen.findByText("Nuovo feedback");
    fireEvent.change(screen.getByLabelText("Feedback strutturato (JSON)"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea bozza feedback" }));

    expect(await screen.findByText("JSON non valido.")).toBeInTheDocument();
    expect(createTeacherFeedback).not.toHaveBeenCalled();
  });
});
