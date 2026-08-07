/**
 * Session TTL parameters. Baseline values approved in the WEB-M1 Fase 2
 * correction report §5 — changing them is a configuration change, not a
 * governance change, since AGENTS.md's "WEB-M1 implementation baseline"
 * deliberately leaves exact numbers to configuration.
 */
export interface SessionSecurityConfig {
  absoluteTtlSeconds: number;
  inactivityTtlSeconds: number;
}

export const DEFAULT_SESSION_SECURITY_CONFIG: SessionSecurityConfig = {
  absoluteTtlSeconds: 12 * 60 * 60,
  inactivityTtlSeconds: 60 * 60,
};
