import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * Baseline "nothing here yet" state (07_05 §16, 07_04 §19) — distinct
 * from `StatusMessage kind="empty"` (a transient inline notice) in that
 * it is a full block layout meant to replace an entire list/table area
 * (empty roster, empty review queue) with a title, optional explanation,
 * and an optional call-to-action.
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="qc-empty-state" role="status">
      <p className="qc-empty-state-title">{title}</p>
      {description ? <p className="qc-empty-state-description">{description}</p> : null}
      {action ? <div className="qc-empty-state-action">{action}</div> : null}
    </div>
  );
}
