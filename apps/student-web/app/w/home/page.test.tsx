import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StudentHomePage from "./page";

const routerReplace = vi.fn();
const logout = vi.fn();
let authStatus: "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated" = "authenticated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("../../../lib/student-auth-context", () => ({
  useStudentAuth: () => ({
    status: authStatus,
    context: { studentPublicId: "std_1", tenantPublicId: "sch_1", classPublicId: "cls_1", enrollmentStatus: "ACTIVE", displayAlias: "Mario" },
    logout,
  }),
}));

const getWebM4Activity = vi.fn();
const getWebTranche1Activity = vi.fn();
const getWebTranche2Activity = vi.fn();

vi.mock("../../../lib/student-api-client", () => ({
  getWebM4Activity: (...args: unknown[]) => getWebM4Activity(...args),
  getWebTranche1Activity: (...args: unknown[]) => getWebTranche1Activity(...args),
  getWebTranche2Activity: (...args: unknown[]) => getWebTranche2Activity(...args),
}));

describe("StudentHomePage", () => {
  beforeEach(() => {
    authStatus = "authenticated";
    routerReplace.mockClear();
    logout.mockClear();
    getWebM4Activity.mockReset();
    getWebTranche1Activity.mockReset();
    getWebTranche2Activity.mockReset();
    // Default: Tranche 1/2's own sections are exercised separately below; other
    // tests only assert on the WEB-M4 section, so keep these calls pending/rejected
    // to avoid extra identical "Inizia l'attività" links colliding with getByRole.
    getWebTranche1Activity.mockRejectedValue(new Error("not stubbed for this test"));
    getWebTranche2Activity.mockRejectedValue(new Error("not stubbed for this test"));
  });

  it("redirects to /w/login when unauthenticated", () => {
    authStatus = "unauthenticated";
    render(<StudentHomePage />);
    expect(routerReplace).toHaveBeenCalledWith("/w/login");
  });

  it("greets the student by their real displayAlias", async () => {
    getWebM4Activity.mockResolvedValue({ assignmentId: "asn-1", activityId: "act-1", title: "Balance Machine" });
    render(<StudentHomePage />);
    expect(screen.getByText("Ciao, Mario")).toBeInTheDocument();
  });

  it("shows a real entry-point link into /w/activity/:assignmentId once the WEB-M4 activity resolves", async () => {
    getWebM4Activity.mockResolvedValue({ assignmentId: "asn-real-1", activityId: "act-1", title: "Balance Machine" });
    render(<StudentHomePage />);
    const link = await screen.findByRole("link", { name: "Inizia l'attività" });
    expect(link).toHaveAttribute("href", "/w/activity/asn-real-1");
  });

  it("shows a localized message when the WEB-M4 activity is not yet available for this school", async () => {
    const { StudentApiError } = await import("../../../lib/student-api-error");
    getWebM4Activity.mockRejectedValue(new StudentApiError("WEB_M4_ACTIVITY_NOT_AVAILABLE", "server text", 404));
    render(<StudentHomePage />);
    expect(await screen.findByText("L'attività non è ancora disponibile per la tua scuola.")).toBeInTheDocument();
  });

  it("shows a real entry-point link into /w/activity/:assignmentId once the Tranche 1 Guided Practice activity resolves", async () => {
    getWebM4Activity.mockRejectedValue(new Error("not stubbed for this test"));
    getWebTranche1Activity.mockResolvedValue({ assignmentId: "asn-tranche1-1", activityId: "act-guided-practice", title: "Pratica guidata" });
    render(<StudentHomePage />);
    const link = await screen.findByRole("link", { name: "Inizia l'attività" });
    expect(link).toHaveAttribute("href", "/w/activity/asn-tranche1-1");
  });

  it("shows a real entry-point link into /w/activity/:assignmentId once the Tranche 2 Quick Question Set activity resolves", async () => {
    getWebM4Activity.mockRejectedValue(new Error("not stubbed for this test"));
    getWebTranche2Activity.mockResolvedValue({ assignmentId: "asn-tranche2-1", activityId: "act-quick-question-set", title: "Domande rapide" });
    render(<StudentHomePage />);
    const link = await screen.findByRole("link", { name: "Inizia l'attività" });
    expect(link).toHaveAttribute("href", "/w/activity/asn-tranche2-1");
  });
});
