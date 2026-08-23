import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MyClassPage from "./page";

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

const getMyClass = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getMyClass: (...args: unknown[]) => getMyClass(...args),
}));

describe("MyClassPage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyClass.mockReset();
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<MyClassPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("shows real class, school and real teacher names, never a raw UUID or email", async () => {
    getMyClass.mockResolvedValue({
      classPublicId: "cls_abc123",
      className: "Classe 2B",
      schoolName: "Istituto Test",
      enrollmentStatus: "ACTIVE",
      teachers: [{ displayName: "Mario Rossi" }, { displayName: "Anna Bianchi" }],
    });
    render(<MyClassPage />);
    expect(await screen.findByText("Classe 2B")).toBeInTheDocument();
    expect(screen.getByText("Istituto Test")).toBeInTheDocument();
    expect(screen.getByText("Mario Rossi")).toBeInTheDocument();
    expect(screen.getByText("Anna Bianchi")).toBeInTheDocument();
    expect(screen.queryByText("cls_abc123")).not.toBeInTheDocument();
  });

  it("shows the documented fallback label for a teacher with no display name set, never their email", async () => {
    getMyClass.mockResolvedValue({
      classPublicId: "cls_y",
      className: "Classe 4D",
      schoolName: "Istituto Test",
      enrollmentStatus: "ACTIVE",
      teachers: [{ displayName: null }],
    });
    render(<MyClassPage />);
    expect(await screen.findByText("Docente")).toBeInTheDocument();
  });

  it("shows a real, honest message when no teacher is assigned yet (not a fabricated name)", async () => {
    getMyClass.mockResolvedValue({
      classPublicId: "cls_x",
      className: "Classe 3C",
      schoolName: "Istituto Test",
      enrollmentStatus: "ACTIVE",
      teachers: [],
    });
    render(<MyClassPage />);
    expect(await screen.findByText("Nessun docente ancora assegnato a questa classe.")).toBeInTheDocument();
  });

  it("shows a localized error message on failure", async () => {
    const { StudentApiError } = await import("../../../lib/student-api-error");
    getMyClass.mockRejectedValue(new StudentApiError("UNKNOWN_ERROR", "server text", 500));
    render(<MyClassPage />);
    expect(await screen.findByText("Non è stato possibile caricare i dati della tua classe.")).toBeInTheDocument();
  });
});
