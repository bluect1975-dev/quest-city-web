import type { ReactNode } from "react";

export type StatusKind = "loading" | "empty" | "error" | "unauthorized" | "network-unavailable";

export interface StatusMessageProps {
  kind: StatusKind;
  children: ReactNode;
}

const ROLE_BY_KIND: Record<StatusKind, "status" | "alert"> = {
  loading: "status",
  empty: "status",
  error: "alert",
  unauthorized: "alert",
  "network-unavailable": "alert",
};

/**
 * Baseline state component (07_05 §16, 07_04 §19): every essential route
 * needs loading/empty/error/unauthorized/network-unavailable states,
 * announced to assistive technology via the appropriate live-region role.
 */
export function StatusMessage({ kind, children }: StatusMessageProps) {
  return (
    <div className={`qc-status qc-status-${kind}`} role={ROLE_BY_KIND[kind]} aria-live="polite">
      {children}
    </div>
  );
}
