import type { ElementType, ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  /** Renders as this element (default `section`) — pass `"div"` when a card wraps non-sectioning content. */
  as?: ElementType;
  /** Visual weight: `default` (existing `qc-card` look) or `muted` (lower-emphasis, e.g. a secondary panel). */
  tone?: "default" | "muted";
  className?: string;
}

/**
 * Reusable card surface, replacing the copy-pasted `className="qc-card"`
 * pattern found at ~20 call sites (Pilot UX/UI Redesign UI-R1 audit) with a
 * real component so new surfaces (M06 activity shell, Platform Admin
 * Control Center) get the same treatment without re-typing the class name.
 * The CSS itself (`.qc-card`) is unchanged — this only wraps it.
 */
export function Card({ children, as: Component = "section", tone = "default", className }: CardProps) {
  const toneClass = tone === "muted" ? "qc-card-muted" : undefined;
  return <Component className={["qc-card", toneClass, className].filter(Boolean).join(" ")}>{children}</Component>;
}
