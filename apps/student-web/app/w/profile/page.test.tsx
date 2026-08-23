import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProfilePage from "./page";

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

describe("ProfilePage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    getMyClass.mockReset();
    getMyClass.mockResolvedValue({
      classPublicId: "cls_1",
      className: "Classe 1A",
      schoolName: "Scuola Test",
      enrollmentStatus: "ACTIVE",
      teachers: [{ displayName: "Mario Rossi" }],
    });
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<ProfilePage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("shows the real alias, school and class — never a PIN", async () => {
    render(<ProfilePage />);
    expect(screen.getByText("Mario")).toBeInTheDocument();
    expect(await screen.findByText("Scuola Test")).toBeInTheDocument();
    expect(screen.getByText("Classe 1A")).toBeInTheDocument();
    expect(screen.queryByText(/pin/i)).not.toBeInTheDocument();
  });
});
