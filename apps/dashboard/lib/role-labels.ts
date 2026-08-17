import type { StaffContext } from "./staff-api-types";

/** Shared between AppShell and ActiveRoleSwitcher -- kept in its own module to avoid a circular import between the two. */
export const ROLE_LABEL_KEY: Record<StaffContext["role"], string> = {
  TEACHER: "app.home.roleTeacher",
  SCHOOL_ADMIN: "app.home.roleSchoolAdmin",
  INDEPENDENT_EDUCATOR: "app.home.roleIndependentEducator",
  SUPPORT_TEACHER: "app.home.roleSupportTeacher",
  ASACOM: "app.home.roleAsacom",
};
