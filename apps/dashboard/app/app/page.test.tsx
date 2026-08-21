import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StaffHomePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("../../lib/staff-auth-context", () => ({
  useStaffAuth: () => ({
    status: "authenticated",
    context: { staffAccountId: "staff-1", tenantId: "tenant-1", role: "TEACHER", classScope: ["class-1"] },
    csrfToken: "csrf-token-123",
  }),
}));

const listFacilitationProposalReviewQueue = vi.fn();
const listMyAssignedStudents = vi.fn();

vi.mock("../../lib/staff-api-client", () => ({
  listFacilitationProposalReviewQueue: (...args: unknown[]) => listFacilitationProposalReviewQueue(...args),
  listMyAssignedStudents: (...args: unknown[]) => listMyAssignedStudents(...args),
}));

describe("StaffHomePage", () => {
  beforeEach(() => {
    listFacilitationProposalReviewQueue.mockReset();
    listMyAssignedStudents.mockReset();
  });

  it("shows the real pending-review count with a working link when items exist", async () => {
    listFacilitationProposalReviewQueue.mockResolvedValue([{ id: "p-1" }, { id: "p-2" }]);
    render(<StaffHomePage />);
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai alle proposte da revisionare" })).toBeInTheDocument();
  });

  it("shows the friendly empty-state copy instead of a dead link when there is nothing pending", async () => {
    listFacilitationProposalReviewQueue.mockResolvedValue([]);
    render(<StaffHomePage />);
    expect(await screen.findByText("Nessuna proposta in attesa.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Vai alle proposte da revisionare" })).not.toBeInTheDocument();
  });
});
