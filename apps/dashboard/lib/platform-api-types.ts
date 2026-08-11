export type Capability = "tenant.create" | "tenant.read" | "tenant.suspend" | "school_admin.activate" | "audit.read.global";

export interface PlatformContext {
  staffAccountId: string;
  capabilities: Capability[];
}

export interface TenantSummary {
  id: string;
  publicId: string;
  type: "SCHOOL" | "ORGANIZATION";
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  name: string;
  createdAt: string;
}

export interface SchoolAdminActivationResponse {
  staffAccountId: string;
  email: string;
  temporaryPassword: string | null;
  identityReused: boolean;
  reactivated: boolean;
}

export interface AuditEventSummary {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  createdAt: string;
}
