/**
 * Staff session TTL and lockout parameters (02_35 §4.4-4.5). Independent
 * config from `@quest-city-web/identity`'s `SessionSecurityConfig` — a
 * staff account is higher-privilege and gets its own tunable thresholds,
 * not the WEB-M1 student session's values.
 */
export interface StaffSessionSecurityConfig {
  absoluteTtlSeconds: number;
  inactivityTtlSeconds: number;
  /** Consecutive failed logins before `staff_account.locked_until` is set (02_35 §4.5). */
  maxFailedLoginAttempts: number;
  /** Lockout duration once `maxFailedLoginAttempts` is reached. */
  lockoutDurationSeconds: number;
}

export const DEFAULT_STAFF_SESSION_SECURITY_CONFIG: StaffSessionSecurityConfig = {
  absoluteTtlSeconds: 12 * 60 * 60,
  inactivityTtlSeconds: 60 * 60,
  maxFailedLoginAttempts: 5,
  lockoutDurationSeconds: 15 * 60,
};
