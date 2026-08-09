import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentLoginPage from "./page";

const routerReplace = vi.fn();
const setSession = vi.fn();
let authStatus: "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated" = "unauthenticated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("../../../lib/student-auth-context", () => ({
  useStudentAuth: () => ({ status: authStatus, setSession }),
}));

const startStudentSession = vi.fn();
const getStudentContext = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  startStudentSession: (...args: unknown[]) => startStudentSession(...args),
  getStudentContext: (...args: unknown[]) => getStudentContext(...args),
}));

import { StudentApiError } from "../../../lib/student-api-error";

describe("StudentLoginPage", () => {
  beforeEach(() => {
    authStatus = "unauthenticated";
    routerReplace.mockClear();
    setSession.mockClear();
    startStudentSession.mockReset();
    getStudentContext.mockReset();
  });

  it("renders the required classCode, accessAlias and pin fields", () => {
    render(<StudentLoginPage />);
    const classCode = screen.getByLabelText("Codice classe");
    const alias = screen.getByLabelText("Il tuo nome (alias)");
    const pin = screen.getByLabelText("PIN");
    expect(classCode).toBeRequired();
    expect(alias).toBeRequired();
    expect(pin).toBeRequired();
    expect(pin).toHaveAttribute("type", "password");
  });

  it("shows a loading label on the submit button while the request is in flight", async () => {
    let resolveSession: (value: { csrfToken: string; studentPublicId: string; tenantPublicId: string; classPublicId: string; sessionExpiresAt: string }) => void;
    startStudentSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    render(<StudentLoginPage />);
    fireEvent.change(screen.getByLabelText("Codice classe"), { target: { value: "CLASS-CODE-1" } });
    fireEvent.change(screen.getByLabelText("Il tuo nome (alias)"), { target: { value: "Mario" } });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    expect(await screen.findByRole("button", { name: "Accesso in corso..." })).toBeInTheDocument();
    resolveSession!({
      csrfToken: "csrf-1",
      studentPublicId: "std_1",
      tenantPublicId: "sch_1",
      classPublicId: "cls_1",
      sessionExpiresAt: "2026-01-01T00:00:00.000Z",
    });
    getStudentContext.mockResolvedValue({
      studentPublicId: "std_1",
      tenantPublicId: "sch_1",
      classPublicId: "cls_1",
      enrollmentStatus: "ACTIVE",
      displayAlias: "Mario",
    });
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/w/home"));
  });

  it("submits the form and establishes the session on success", async () => {
    startStudentSession.mockResolvedValue({
      csrfToken: "csrf-token-123",
      studentPublicId: "std_1",
      tenantPublicId: "sch_1",
      classPublicId: "cls_1",
      sessionExpiresAt: "2026-01-01T00:00:00.000Z",
    });
    getStudentContext.mockResolvedValue({
      studentPublicId: "std_1",
      tenantPublicId: "sch_1",
      classPublicId: "cls_1",
      enrollmentStatus: "ACTIVE",
      displayAlias: "Mario",
    });

    render(<StudentLoginPage />);
    fireEvent.change(screen.getByLabelText("Codice classe"), { target: { value: "CLASS-CODE-1" } });
    fireEvent.change(screen.getByLabelText("Il tuo nome (alias)"), { target: { value: "Mario" } });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    await waitFor(() => {
      expect(startStudentSession).toHaveBeenCalledWith({ classCode: "CLASS-CODE-1", accessAlias: "Mario", pin: "123456" });
    });
    await waitFor(() => expect(getStudentContext).toHaveBeenCalled());
    await waitFor(() =>
      expect(setSession).toHaveBeenCalledWith(
        { studentPublicId: "std_1", tenantPublicId: "sch_1", classPublicId: "cls_1", enrollmentStatus: "ACTIVE", displayAlias: "Mario" },
        "csrf-token-123",
      ),
    );
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/w/home"));
  });

  it("shows the localized error message when the credentials are rejected", async () => {
    startStudentSession.mockRejectedValue(new StudentApiError("ACCESS_CREDENTIALS_INVALID", "server text", 401));

    render(<StudentLoginPage />);
    fireEvent.change(screen.getByLabelText("Codice classe"), { target: { value: "CLASS-CODE-1" } });
    fireEvent.change(screen.getByLabelText("Il tuo nome (alias)"), { target: { value: "Mario" } });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    expect(await screen.findByText("Alias o PIN non corretti.")).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalledWith("/w/home");
  });

  it("redirects to /w/home when already authenticated", () => {
    authStatus = "authenticated";
    render(<StudentLoginPage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/home");
  });
});
