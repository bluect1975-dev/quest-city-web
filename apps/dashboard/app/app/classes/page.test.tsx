import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StaffClassesPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("../../../lib/staff-auth-context", () => ({
  useStaffAuth: () => ({
    status: "authenticated",
    context: { staffAccountId: "staff-1", tenantId: "tenant-1", role: "SCHOOL_ADMIN", classScope: null },
  }),
}));

const listClasses = vi.fn();

vi.mock("../../../lib/staff-api-client", () => ({
  listClasses: (...args: unknown[]) => listClasses(...args),
}));

import { StaffApiError } from "../../../lib/staff-api-error";

describe("StaffClassesPage", () => {
  beforeEach(() => {
    listClasses.mockReset();
  });

  it("renders each class from a non-empty list, with the class name visible", async () => {
    listClasses.mockResolvedValue([
      { classId: "class-1", name: "Classe 3A" },
      { classId: "class-2", name: "Classe 4B" },
    ]);

    render(<StaffClassesPage />);

    expect(await screen.findByText("Classe 3A")).toBeInTheDocument();
    expect(screen.getByText("Classe 4B")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Apri" })).toHaveLength(2);
  });

  it("renders the EmptyState instead of a table when the class list is empty", async () => {
    listClasses.mockResolvedValue([]);

    render(<StaffClassesPage />);

    const title = await screen.findByText("Nessuna classe nel tuo ambito.");
    expect(title.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("error localization: renders the localized it-IT string for a known API error code, not the raw code", async () => {
    listClasses.mockRejectedValue(new StaffApiError("CLASS_ACCESS_DENIED", "server text", 403));

    render(<StaffClassesPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Questa risorsa non è disponibile o non è nel tuo ambito.");
    expect(alert).not.toHaveTextContent("CLASS_ACCESS_DENIED");
  });
});
