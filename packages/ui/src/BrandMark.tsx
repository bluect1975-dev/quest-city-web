export interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Quest City wordmark glyph (Pilot UX/UI Redesign UI-R1 §10, retinted for
 * UAT Failure Remediation's visual identity — every login screen and
 * shell header previously showed the brand as plain bold text with no
 * mark at all). An abstract "city skyline / path" motif: three ascending
 * blocks (progression, districts) crossed by a single upward route (the
 * learning path) — deliberately geometric and simple rather than a
 * mascot. Each block now carries a real brand color (Dawn Amber, a
 * near-white, Beacon Teal) instead of monochrome opacity steps, since it
 * always renders on the dark Ink shell header now (Student, Teacher and
 * Platform Admin alike) — the route line stays `currentColor` so it still
 * adapts to whichever text color surrounds it. Not an imitation of any
 * existing product's mark (§10).
 */
export function BrandMark({ size = 22, className }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={["qc-brand-mark", className].filter(Boolean).join(" ")}
    >
      <rect x="2.5" y="13" width="4.5" height="8.5" rx="1" fill="var(--qc-color-primary-on-dark, currentColor)" />
      <rect x="9.75" y="8.5" width="4.5" height="13" rx="1" fill="#f4f1ea" />
      <rect x="17" y="3.5" width="4.5" height="18" rx="1" fill="var(--qc-color-teal, currentColor)" />
      <path d="M3.5 17.5 11 12l3-3.5L20 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}
