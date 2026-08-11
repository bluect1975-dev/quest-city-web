import { describe, expect, it } from "vitest";
import { PlatformAdminError } from "../errors";
import { assertCapability } from "./authorization";
import type { PlatformAdminIdentity } from "./platform-auth-service";

function identity(capabilities: PlatformAdminIdentity["capabilities"]): PlatformAdminIdentity {
  return {
    staffAccountId: "platform-admin-1",
    platformAdminGrantId: "grant-1",
    capabilities,
    csrfTokenHash: "unused-in-these-tests",
  };
}

describe("assertCapability (02_27 §5.3, 02_38 §4.1 capability-first authorization)", () => {
  it("does not throw when the identity holds the required capability", () => {
    expect(() => assertCapability(identity(["tenant.create"]), "tenant.create")).not.toThrow();
  });

  it("throws CAPABILITY_DENIED when the identity lacks the required capability, even with other capabilities granted", () => {
    try {
      assertCapability(identity(["tenant.read"]), "tenant.create");
      throw new Error("expected assertCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformAdminError);
      expect((error as PlatformAdminError).code).toBe("CAPABILITY_DENIED");
      expect((error as PlatformAdminError).httpStatus).toBe(403);
    }
  });

  it("throws CAPABILITY_DENIED for an identity with zero capabilities (role alone never authorizes)", () => {
    expect(() => assertCapability(identity([]), "audit.read.global")).toThrow(PlatformAdminError);
  });
});
