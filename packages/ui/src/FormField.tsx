import type { ReactElement, ReactNode } from "react";
import { useId } from "react";

export interface FormFieldProps {
  label: ReactNode;
  children: (fieldProps: { id: string; "aria-describedby": string | undefined }) => ReactElement;
  hint?: ReactNode;
  error?: ReactNode;
}

/**
 * Baseline accessible form field (07_04 §10, §13): associates a
 * `<label>` with its control via `htmlFor`/`id`, and wires `hint`/`error`
 * text into `aria-describedby` so assistive technology announces both —
 * `children` is a render-prop rather than a fixed `<input>` so the same
 * wrapper works for text inputs, selects, and textareas alike.
 */
export function FormField({ label, children, hint, error }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="qc-form-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="qc-form-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="qc-form-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
