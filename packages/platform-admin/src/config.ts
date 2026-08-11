/**
 * Platform admin session TTL and lockout parameters. Independent config
 * from `@quest-city-web/staff-identity`'s `StaffSessionSecurityConfig` --
 * a platform admin is the highest-privilege identity in the system and
 * gets its own tunable thresholds, never implicitly inherited from a
 * lower-privilege domain's defaults.
 */
export interface PlatformAdminSessionSecurityConfig {
  absoluteTtlSeconds: number;
  inactivityTtlSeconds: number;
  /** Consecutive failed logins before `staff_account.locked_until` is set (same field/mechanism as staff auth, 02_35 §4.5). */
  maxFailedLoginAttempts: number;
  lockoutDurationSeconds: number;
}

export const DEFAULT_PLATFORM_ADMIN_SESSION_SECURITY_CONFIG: PlatformAdminSessionSecurityConfig = {
  absoluteTtlSeconds: 12 * 60 * 60,
  inactivityTtlSeconds: 60 * 60,
  maxFailedLoginAttempts: 5,
  lockoutDurationSeconds: 15 * 60,
};
