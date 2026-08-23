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
  attemptState: "COMPLETED" as const,
  startedAt: "2026-08-23T16:41:00.000Z",
  completedAt: "2026-08-23T16:43:00.000Z",
  studentAnswer: { solvedValue: 4, leftWeights: 2 },
  semanticActions: [{ actionId: "act-1", actionType: "CONFIRM_SOLUTION", targetRole: null, payload: {}, clientSequence: 0, occurredAt: "2026-08-23T16:43:00.000Z" }],
  hints: [],
  validatorOutcome: { correctness: "CORRECT", validatorVersion: "1.0.0" },
  proposedAiFeedback: null,
  previousAttempts: [],
  relatedCompetencies: [],
  runtimeChannel: "WEB" as const,
  reconciliationStatus: "CONSOLIDATED" as const,
};

const EMPTY_ATTEMPT_REVIEW_DETAIL = {
  ...ATTEMPT_REVIEW_DETAIL,
  attemptState: "CREATED" as const,
  completedAt: null,
  studentAnswer: {},
  semanticActions: [],
  validatorOutcome: null,
  reconciliationStatus: null,
};

describe("StaffAttemptReviewPage", () => {
  beforeEach(() => {
    getAttemptReviewDetail.mockReset();
    createTeacherFeedback.mockReset();
    getAttemptReviewDetail.mockResolvedValue(ATTEMPT_REVIEW_DETAIL);
  });

  it("renders a human attempt status and never a raw enum, plus a humanized (non-JSON) student answer and action timeline", async () => {
    render(<StaffAttemptReviewPage />);
    expect(await screen.findByText("Completato")).toBeInTheDocument();
    // The raw enum/JSON is never in the PRIMARY presentation — only inside
    // the collapsed technical-details <details> (covered by its own test below).
    const technicalDetails = screen.getByText("Dettagli tecnici").closest("details")!;
    expect(technicalDetails).toContainElement(screen.getByText(/"COMPLETED"/));
    // studentAnswer keys render humanized, not as raw JSON syntax, OUTSIDE the technical details.
    const solvedValueLabel = screen.getByText("Solved value");
    expect(technicalDetails).not.toContainElement(solvedValueLabel);
    // the semantic action renders as a human sentence, not the raw enum.
    expect(screen.getByText("Ha confermato la soluzione")).toBeInTheDocument();
    expect(screen.getByText("Risposta corretta")).toBeInTheDocument();
  });

  it("clearly labels a CREATED (empty, never-played) attempt and hides the feedback form entirely (UAT-RC4-TEACHER-REVIEW-CREATED-EMPTY-ATTEMPT-01)", async () => {
    getAttemptReviewDetail.mockResolvedValue(EMPTY_ATTEMPT_REVIEW_DETAIL);
    render(<StaffAttemptReviewPage />);
    expect(await screen.findByText(/mai stato avviato dallo studente/)).toBeInTheDocument();
    expect(screen.queryByText("Feedback per lo studente")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crea bozza feedback" })).not.toBeInTheDocument();
  });

  it("submits the feedback form with only free text — never a structured-JSON field visible to the docente (UAT-RC4-TEACHER-REVIEW-RAW-JSON-01)", async () => {
    createTeacherFeedback.mockResolvedValue({
      id: "feedback-1",
      tenantId: "tenant-1",
      classId: "class-1",
      studentProfileId: "student-1",
      learningAttemptId: "attempt-1",
      authorStaffId: "staff-1",
      structuredFeedback: {},
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

    await screen.findByText("Feedback per lo studente");
    expect(screen.queryByLabelText("Feedback strutturato (JSON)")).not.toBeInTheDocument();

    const freeTextField = screen.getByLabelText("Messaggio per lo studente");
    fireEvent.change(freeTextField, { target: { value: "Ottimo lavoro" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea bozza feedback" }));

    await waitFor(() =>
      expect(createTeacherFeedback).toHaveBeenCalledWith({
        attemptId: "attempt-1",
        structuredFeedback: {},
        freeText: "Ottimo lavoro",
        originReviewQueueItemId: "review-1",
        csrfToken: "csrf-token-123",
      }),
    );

    expect(await screen.findByText("Bozza")).toBeInTheDocument();
  });

  it("keeps the raw technical JSON available, but only inside a collapsed technical-details disclosure", async () => {
    render(<StaffAttemptReviewPage />);
    await screen.findByText("Completato");
    const details = screen.getByText("Dettagli tecnici").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(/"solvedValue"/);
  });
});
