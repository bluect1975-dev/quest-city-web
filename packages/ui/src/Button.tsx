import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
}

/**
 * Baseline accessible button (07_04 §10, §13): keyboard-operable by default
 * (native <button>), visible focus state, no essential meaning conveyed by
 * color alone.
 */
export function Button({ children, variant = "primary", className, ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "qc-button-primary" : "qc-button-secondary";
  return (
    <button className={["qc-button", variantClass, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}
