import type { ReactNode } from "react";

export interface ProgressRingProps {
  value: number;
  max: number;
  /** Plain string rendered as the ring's second SVG text line, e.g. "di 2 tappe" — caller-supplied so this component never bakes in Italian/English copy itself. */
  caption: string;
  /** Rendered as HTML text below the ring. */
  label: ReactNode;
}

/**
 * A real completion-ring visualization (UAT Failure Remediation,
 * `UAT-RC4-VISUAL-DIRECTION-01`) for "Progressi" — replaces a bare
 * number with a genuine sense of "how far along am I". `role="img"` with
 * a full text `aria-label` carries the same information for assistive
 * tech as the visible ring + text, so nothing is color/shape-only.
 */
export function ProgressRing({ value, max, caption, label }: ProgressRingProps) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const offset = circumference * (1 - ratio);

  return (
    <div className="qc-progress-ring-wrap" role="img" aria-label={`${value} ${caption}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--qc-color-ink-2)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--qc-color-primary-on-dark)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        <text x="60" y="58" textAnchor="middle" className="qc-progress-ring-value" fontSize="30">
          {value}
        </text>
        <text x="60" y="80" textAnchor="middle" className="qc-progress-ring-caption" fontSize="12">
          {caption}
        </text>
      </svg>
      <span className="qc-progress-ring-label">{label}</span>
    </div>
  );
}
