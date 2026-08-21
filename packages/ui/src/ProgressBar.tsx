import { useId, type ReactNode } from "react";

export interface ProgressBarProps {
  /** Current value, 0..max. */
  value: number;
  max: number;
  /** Visible label (e.g. "3 di 8 completati") — never color-only (07_04 §13). */
  label: ReactNode;
}

/**
 * Determinate progress bar (Pilot UX/UI Redesign UI-R1 §14 — the M06
 * full-sequence host previously showed only a text string, "Stage 1 di 14",
 * with no visual bar anywhere in the product). `label` is always rendered
 * as real text above the bar, so the percentage is never conveyed by fill
 * color/width alone. `aria-labelledby` (rather than `aria-label`, which
 * requires a plain string) gives the `role="progressbar"` element the
 * accessible name a real axe-core scan found missing (UI-R6) — the
 * visible label doubles as its accessible name instead of a duplicate.
 */
export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const labelId = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = max > 0 ? Math.round((clamped / max) * 100) : 0;
  return (
    <div className="qc-progress-bar">
      <div className="qc-progress-bar-label" id={labelId}>
        {label}
      </div>
      <div
        className="qc-progress-bar-track"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-labelledby={labelId}
      >
        <div className="qc-progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
