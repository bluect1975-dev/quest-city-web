import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StudentHomePage from "./page";

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

const getMyAssignments = vi.fn();
const getMyClass = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getMyAssignments: (...args: unknown[]) => getMyAssignments(...args),
  getMyClass: (...args: unknown[]) => getMyClass(...args),
}));

describe("StudentHomePage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyAssignments.mockReset();
    getMyAssignments.mockResolvedValue([]);
    getMyClass.mockReset();
    getMyClass.mockResolvedValue({
      classPublicId: "cls_1",
      className: "Classe 1A",
      schoolName: "Scuola Test",
      enrollmentStatus: "ACTIVE",
      teachers: [{ displayName: "Mario Rossi" }, { displayName: null }],
    });
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<StudentHomePage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("greets the student by their real displayAlias", async () => {
    render(<StudentHomePage />);
    expect(screen.getByText("Ciao, Mario")).toBeInTheDocument();
  });

  it("always shows the current-mission hero linking into /w/full-sequence, the real pilot curriculum path", () => {
    render(<StudentHomePage />);
    const link = screen.getByRole("link", { name: "Inizia il percorso completo" });
    expect(link).toHaveAttribute("href", "/w/full-sequence");
  });

  it("shows a real empty state (not a bare string) when there are no assignments, explaining it is not an error", async () => {
    render(<StudentHomePage />);
    expect(await screen.findByText("Nessuna assegnazione al momento")).toBeInTheDocument();
    expect(screen.getByText(/Non è un errore/)).toBeInTheDocument();
  });

  it("shows a localized message when assignments fail to load", async () => {
    const { StudentApiError } = await import("../../../lib/student-api-error");
    getMyAssignments.mockRejectedValue(new StudentApiError("UNKNOWN_ERROR", "server text", 500));
    render(<StudentHomePage />);
    expect(await screen.findByText("Non è stato possibile caricare le assegnazioni.")).toBeInTheDocument();
  });

  it("shows the student's real class and school name (Pilot Product Experience Remediation G3)", async () => {
    render(<StudentHomePage />);
    expect(await screen.findByText("Scuola Test")).toBeInTheDocument();
    expect(screen.getByText("Classe 1A")).toBeInTheDocument();
  });

  it("renders a real assignment with its status and a working entry-point link", async () => {
    getMyAssignments.mockResolvedValue([
      { assignmentId: "asn-1", contentBundleId: "bnd-1", title: "Compito extra", completionStatus: "IN_PROGRESS", latestAttemptId: null, dueAt: null },
    ]);
    render(<StudentHomePage />);
    expect(await screen.findByText("Compito extra")).toBeInTheDocument();
    expect(screen.getByText("In corso")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Riprendi" });
    expect(link).toHaveAttribute("href", "/w/activity/asn-1");
  });
});
