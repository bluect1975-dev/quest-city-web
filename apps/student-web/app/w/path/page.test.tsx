import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MyPathPage from "./page";

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

const getMyPath = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getMyPath: (...args: unknown[]) => getMyPath(...args),
}));

describe("MyPathPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyPath.mockReset();
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<MyPathPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("renders each item's real GLPC-derived state — completed, locked, current, available — never fabricated", async () => {
    getMyPath.mockResolvedValue({
      items: [
        { assignmentId: "asn-1", contentBundleId: "bnd-1", title: "Balance Machine Challenge", subjectId: "MAT", pathState: "COMPLETED", dueAt: null },
        { assignmentId: "asn-2", contentBundleId: "bnd-2", title: "Riattiva la Balance Machine", subjectId: "MAT", pathState: "CURRENT", dueAt: null },
        { assignmentId: "asn-3", contentBundleId: "bnd-3", title: "Sfida finale", subjectId: "MAT", pathState: "LOCKED", dueAt: null },
        { assignmentId: "asn-4", contentBundleId: "bnd-4", title: "Verifica", subjectId: "MAT", pathState: "AVAILABLE", dueAt: null },
      ],
      progress: { completedCount: 1, totalCount: 4 },
    });
    render(<MyPathPage />);
    // Real titles render as-is, and each stop's real state is a distinct, visible badge — never fabricated or color-only.
    expect(await screen.findByText("Balance Machine Challenge")).toBeInTheDocument();
    expect(screen.getByText("Riattiva la Balance Machine").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Sfida finale")).toBeInTheDocument();
    expect(screen.getByText("Verifica")).toBeInTheDocument();
    expect(screen.getAllByText("Completata").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In corso").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bloccata").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disponibile").length).toBeGreaterThan(0);
    // Real, derived-from-order stage numbering, distinguishing the current stop by text (never color alone).
    expect(screen.getByText("Tappa 2 · sei qui")).toBeInTheDocument();
  });

  it("groups items by real subject and shows a real overall progress count", async () => {
    getMyPath.mockResolvedValue({
      items: [{ assignmentId: "asn-1", contentBundleId: "bnd-1", title: "Tappa 1", subjectId: "MAT", pathState: "AVAILABLE", dueAt: null }],
      progress: { completedCount: 0, totalCount: 1 },
    });
    render(<MyPathPage />);
    expect(await screen.findByText("Matematica")).toBeInTheDocument();
    expect(screen.getByText("Completate 0 di 1")).toBeInTheDocument();
  });

  it("shows a real empty state when the student has no assignments yet", async () => {
    getMyPath.mockResolvedValue({ items: [], progress: { completedCount: 0, totalCount: 0 } });
    render(<MyPathPage />);
    expect(await screen.findByText("Il tuo percorso non è ancora disponibile")).toBeInTheDocument();
  });
});
