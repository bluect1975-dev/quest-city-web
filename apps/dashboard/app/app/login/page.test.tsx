import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StaffLoginPage from "./page";

const routerReplace = vi.fn();
const setSession = vi.fn();
let authStatus: "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated" = "unauthenticated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("../../../lib/staff-auth-context", () => ({
  useStaffAuth: () => ({ status: authStatus, setSession }),
}));

const startStaffSession = vi.fn();
const getStaffContext = vi.fn();

vi.mock("../../../lib/staff-api-client", () => ({
  startStaffSession: (...args: unknown[]) => startStaffSession(...args),
  getStaffContext: (...args: unknown[]) => getStaffContext(...args),
}));

import { StaffApiError } from "../../../lib/staff-api-error";

describe("StaffLoginPage", () => {
  beforeEach(() => {
    authStatus = "unauthenticated";
    routerReplace.mockClear();
    setSession.mockClear();
    startStaffSession.mockReset();
    getStaffContext.mockReset();
  });

  it("renders the required email and password fields", () => {
    render(<StaffLoginPage />);
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(email).toBeRequired();
    expect(password).toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("type", "password");
  });

  it("submits the form and calls startStaffSession with the entered credentials, then establishes the session", async () => {
    startStaffSession.mockResolvedValue({ csrfToken: "csrf-token-123", tenantId: "tenant-1", role: "TEACHER" });
    getStaffContext.mockResolvedValue({
      staffAccountId: "staff-1",
      tenantId: "tenant-1",
      role: "TEACHER",
      classScope: null,
    });

    render(<StaffLoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "teacher@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret-pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    await waitFor(() => {
      expect(startStaffSession).toHaveBeenCalledWith({
        email: "teacher@example.com",
        password: "s3cret-pw",
        tenantId: undefined,
      });
    });
    await waitFor(() => expect(getStaffContext).toHaveBeenCalled());
    await waitFor(() => expect(setSession).toHaveBeenCalledWith(
      { staffAccountId: "staff-1", tenantId: "tenant-1", role: "TEACHER", classScope: null },
      "csrf-token-123",
    ));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/app"));
  });

  it("shows the localized error message when the credentials are rejected", async () => {
    startStaffSession.mockRejectedValue(new StaffApiError("STAFF_ACCOUNT_LOCKED", "server text", 423));

    render(<StaffLoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "teacher@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    expect(
      await screen.findByText("Account temporaneamente bloccato per troppi tentativi falliti."),
    ).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalledWith("/app");
  });

  it("keyboard navigation baseline: no interactive element traps focus with a positive tabIndex, and submitting the form (as Enter in a field natively does) invokes the submit handler", async () => {
    startStaffSession.mockResolvedValue({ csrfToken: "csrf", tenantId: "tenant-1", role: "TEACHER" });
    getStaffContext.mockResolvedValue({
      staffAccountId: "staff-1",
      tenantId: "tenant-1",
      role: "TEACHER",
      classScope: null,
    });

    const { container } = render(<StaffLoginPage />);
    const interactive = container.querySelectorAll("input, button, a, select, textarea");
    expect(interactive.length).toBeGreaterThan(0);
    interactive.forEach((element) => {
      const tabIndex = element.getAttribute("tabindex");
      if (tabIndex !== null) {
        expect(Number(tabIndex)).toBeLessThanOrEqual(0);
      }
    });

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "teacher@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret-pw" } });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    // Pressing Enter inside a text field of a <form> with a submit button
    // natively dispatches a `submit` event in every browser; jsdom does
    // not replicate that implicit behaviour, so this asserts the handler
    // this native behaviour would invoke is correctly wired to the form.
    fireEvent.submit(form!);

    await waitFor(() => expect(startStaffSession).toHaveBeenCalled());
  });
});
