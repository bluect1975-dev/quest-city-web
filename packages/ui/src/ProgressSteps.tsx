import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type ProgressStepState = "completed" | "current" | "next" | "locked";

export interface ProgressStep {
  id: string;
  label: ReactNode;
  state: ProgressStepState;
}

export interface ProgressStepsProps {
  steps: ProgressStep[];
}

/**
 * Step-by-step path indicator (Pilot UX/UI Redesign UI-R1 §14) — represents
 * completed/current/next/locked without relying on color alone: each state
 * gets a distinct icon (check / filled dot / outline dot / lock) plus text.
 * An `<ol>` so assistive tech announces both position and count; the
 * current step also carries `aria-current="step"` (07_04 §13).
 */
export function ProgressSteps({ steps }: ProgressStepsProps) {
  return (
    <ol className="qc-progress-steps">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`qc-progress-step qc-progress-step-${step.state}`}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="qc-progress-step-marker">
            {step.state === "completed" ? <Icon name="check" size={14} /> : null}
            {step.state === "locked" ? <Icon name="lock" size={12} /> : null}
          </span>
          <span className="qc-progress-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
