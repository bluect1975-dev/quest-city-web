import type { SVGAttributes } from "react";

/**
 * Minimal inline-SVG icon set (Pilot UX/UI Redesign UI-R1 §11 — audit found
 * zero general-purpose icons anywhere in either app; the only existing SVGs
 * are the 7 M06 intro-hook scene assets, purpose-built for that one stage).
 * Deliberately small and hand-drawn (24x24, single stroke, currentColor) —
 * not a generated/downloaded icon library — covering only the names this
 * redesign actually uses, extended as later tranches need more. Every icon
 * is `aria-hidden` by default: icons here are always paired with visible
 * text (labels, StatusBadge text, button text), never the sole conveyor of
 * meaning (07_04 §13 — never color/icon alone).
 */
const PATHS = {
  check: "M4.5 12.5 9 17l10.5-11",
  lock: "M6 10.5V8a6 6 0 1 1 12 0v2.5 M4.5 10.5h15V20h-15z",
  "chevron-right": "M9 5l7 7-7 7",
  home: "M4 11 12 4l8 7 M6 10v9h12v-9",
  book: "M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 0-3-3z M17 20a3 3 0 0 0-3-3H5",
  users: "M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a5.5 5.5 0 0 1 11 0 M16 12a3 3 0 1 0 0-6 M15 14.2a5 5 0 0 1 6.5 4.8",
  "alert-circle": "M12 3.5 21.5 20h-19z M12 9v5 M12 17.2v.1",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.3v.1",
  star: "M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  logout: "M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9 M15 16l4-4-4-4 M19 12H9",
  scale: "M12 3v3 M12 6l-6 12h12z M12 6l6 12h-12 M4.5 15h3 M16.5 15h3 M6 21h12",
  target: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M12 3v2.5 M12 18.5V21 M3 12h2.5 M18.5 12H21",
  /* Mission-path "you are here" marker (UAT Failure Remediation visual identity). */
  flag: "M5 21V4 M5 5h13l-3 4 3 4H5",
  route: "M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 16v-3a4 4 0 0 1 4-4h4",
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "children"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["qc-icon", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
