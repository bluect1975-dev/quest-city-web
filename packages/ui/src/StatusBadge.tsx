import type { ReactNode } from "react";

export type StatusBadgeTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  children: ReactNode;
}

/**
 * Baseline status indicator (07_04 §13: "no essential meaning conveyed by
 * color alone") — the tone drives a CSS class for color, but the visible
 * text itself (review_queue_item.status, teacher_feedback.publicationStatus/
 * deliveryStatus) is always the real, localized status label, never an
 * icon-only or color-only signal.
 */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`qc-status-badge qc-status-badge-${tone}`}>{children}</span>;
}
