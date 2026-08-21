import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StaffReviewPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("../../../lib/staff-auth-context", () => ({
  useStaffAuth: () => ({
    status: "authenticated",
    context: { staffAccountId: "staff-1", tenantId: "tenant-1", role: "SCHOOL_ADMIN", classScope: null },
    csrfToken: "csrf-token-123",
  }),
}));

const listReviewQueue = vi.fn();
const transitionReviewItemStatus = vi.fn();

vi.mock("../../../lib/staff-api-client", () => ({
  listReviewQueue: (...args: unknown[]) => listReviewQueue(...args),
  transitionReviewItemStatus: (...args: unknown[]) => transitionReviewItemStatus(...args),
}));

const REVIEW_ITEM = {
  id: "review-1",
  tenantId: "tenant-1",
  classId: "class-1",
  studentProfileId: "student-1",
  learningAttemptId: "attempt-1",
  reason: "HELP_REQUESTED" as const,
  priority: "HIGH" as const,
  status: "OPEN" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  reviewedAt: null,
  reviewerStaffId: null,
  version: 1,
};

describe("StaffReviewPage", () => {
  beforeEach(() => {
    listReviewQueue.mockReset();
    transitionReviewItemStatus.mockReset();
  });

  it("renders review queue items with friendly, localized status/priority/reason labels — never the raw enum", async () => {
    listReviewQueue.mockResolvedValue([REVIEW_ITEM]);

    render(<StaffReviewPage />);

    expect(await screen.findByText("Alta")).toBeInTheDocument();
    expect(screen.getAllByText("Aperto").length).toBeGreaterThan(0); // table cell + the filter dropdown option share the same label
    expect(screen.getByText("Aiuto richiesto")).toBeInTheDocument();
    expect(screen.queryByText("HIGH")).not.toBeInTheDocument();
    expect(screen.queryByText("OPEN")).not.toBeInTheDocument();
    expect(screen.queryByText("HELP_REQUESTED")).not.toBeInTheDocument();
  });

  it("renders the EmptyState when the review queue is empty", async () => {
    listReviewQueue.mockResolvedValue([]);

    render(<StaffReviewPage />);

    const title = await screen.findByText("Nessun elemento nella coda di revisione.");
    expect(title.closest('[role="status"]')).not.toBeNull();
  });

  it("claiming an OPEN item calls transitionReviewItemStatus with the expected payload", async () => {
    listReviewQueue.mockResolvedValue([REVIEW_ITEM]);
    transitionReviewItemStatus.mockResolvedValue({ ...REVIEW_ITEM, status: "IN_REVIEW", version: 2 });

    render(<StaffReviewPage />);

    const claimButton = await screen.findByRole("button", { name: "Prendi in carico" });
    fireEvent.click(claimButton);

    await waitFor(() =>
      expect(transitionReviewItemStatus).toHaveBeenCalledWith({
        reviewItemId: "review-1",
        targetStatus: "IN_REVIEW",
        version: 1,
        csrfToken: "csrf-token-123",
      }),
    );
  });
});
