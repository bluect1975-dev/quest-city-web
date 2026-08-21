import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ControlCenterOverviewPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/app/platform-admin/control-center/overview",
}));

vi.mock("../../../../../lib/platform-auth-context", () => ({
  usePlatformAuth: () => ({
    status: "authenticated",
    context: { staffAccountId: "admin-1", capabilities: ["operations.dashboard.view"] },
  }),
}));

const getOperationsOverview = vi.fn();

vi.mock("../../../../../lib/platform-api-client", () => ({
  getOperationsOverview: (...args: unknown[]) => getOperationsOverview(...args),
}));

describe("ControlCenterOverviewPage", () => {
  it("renders the friendly platform-status and staff-role labels, never the raw enum", async () => {
    getOperationsOverview.mockResolvedValue({
      platformStatus: "HEALTHY",
      kpi: {
        schoolsTotal: 3,
        schoolsActive: 3,
        schoolsSuspended: 0,
        independentEducatorsTotal: 0,
        classesTotal: 5,
        staffByRole: [{ role: "SCHOOL_ADMIN", activeMemberships: 1, uniqueHumans: 1 }],
        staffUniqueHumansTotal: 2,
        studentsEnrolled: 30,
        studentsOnlineNow: 0,
        staffOnlineNow: 0,
        activeLearningAttempts: 0,
      },
      openIncidents: 0,
      lastBackup: { status: "OK" },
    });

    render(<ControlCenterOverviewPage />);

    expect(await screen.findByText("Operativa")).toBeInTheDocument();
    expect(screen.getByText("Amministratore scuola")).toBeInTheDocument();
    expect(screen.queryByText("HEALTHY")).not.toBeInTheDocument();
    expect(screen.queryByText("SCHOOL_ADMIN")).not.toBeInTheDocument();
    // The KPI values render as real StatsCards, not a bare unstyled <dl>.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Scuole totali")).toBeInTheDocument();
  });
});
