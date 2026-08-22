/**
 * Session TTL parameters. Baseline values approved in the WEB-M1 Fase 2
 * correction report §5 — changing them is a configuration change, not a
 * governance change, since AGENTS.md's "WEB-M1 implementation baseline"
 * deliberately leaves exact numbers to configuration.
 */
export interface SessionSecurityConfig {
  absoluteTtlSeconds: number;
  inactivityTtlSeconds: number;
  /**
   * Pilot Product Experience Remediation Tranche G9 (SEC-STUDENT-PIN-01).
   * Deliberately NOT copied from the staff config's 5 attempts (mission
   * §35 "NON copiare automaticamente soglie staff"): a student's
   * fixed-window rate limits (`SESSION_START_ENROLLMENT`, 5 attempts/
   * 15min) already gate short-burst velocity, so this counter's job is
   * different — bound the classmate-DOS scenario the mission's own threat
   * model names (§34: known class code + guessable alias + shared school
   * network) once an attacker keeps retrying across successive reset
   * windows. A higher threshold than staff's (10, not 5) tolerates the
   * realistic case of a student mistyping their own 6-8 digit PIN a few
   * times without tripping a lockout on legitimate use, while a short
   * lockout (15 minutes, same order as staff) bounds how long a malicious
   * classmate can deny the real student access — long enough to matter,
   * short enough that no staff-side manual unlock is required for the
   * common case (a longer/indefinite lock was deliberately rejected per
   * §36 "il lockout non deve permettere facilmente ad altri studenti di
   * bloccare permanentemente il bersaglio").
   */
  maxFailedPinAttempts: number;
  pinLockoutDurationSeconds: number;
}

export const DEFAULT_SESSION_SECURITY_CONFIG: SessionSecurityConfig = {
  absoluteTtlSeconds: 12 * 60 * 60,
  inactivityTtlSeconds: 60 * 60,
  maxFailedPinAttempts: 10,
  pinLockoutDurationSeconds: 15 * 60,
};
