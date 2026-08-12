export type Capability =
  | "tenant.create"
  | "tenant.read"
  | "tenant.suspend"
  | "school_admin.activate"
  | "audit.read.global"
  | "independent_educator.activate"
  | "independent_educator.read"
  | "independent_educator.status.manage";

export interface PlatformContext {
  staffAccountId: string;
  capabilities: Capability[];
}

export interface TenantSummary {
  id: string;
  publicId: string;
  type: "SCHOOL" | "INDEPENDENT_EDUCATOR";
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  name: string;
  createdAt: string;
}

export interface IndependentEducatorSummary {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  tenantName: string;
  staffAccountId: string;
  email: string;
  membershipStatus: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface IndependentEducatorActivationResponse {
  tenantId: string;
  tenantPublicId: string;
  staffAccountId: string;
  email: string;
  temporaryPassword: string | null;
  identityReused: boolean;
}

export interface IndependentEducatorStatusResponse {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  membershipStatus: "ACTIVE" | "SUSPENDED";
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
