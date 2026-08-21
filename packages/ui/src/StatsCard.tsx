import type { ReactNode } from "react";
import { Card } from "./Card";

export interface StatsCardProps {
  label: ReactNode;
  value: ReactNode;
  action?: ReactNode;
}

/**
 * A single at-a-glance metric (Pilot UX/UI Redesign UI-R4 §27) — replaces
 * the plain `<p>{count} <Link>...</Link></p>` pattern found on the teacher
 * home page with a real, scannable stat: a small label above a large
 * value, an optional link/button below. Deliberately understated (no
 * icons, no color-coding by default) — staff surfaces stay informational,
 * never game-like (§27 "Non usare estetica da videogame").
 */
export function StatsCard({ label, value, action }: StatsCardProps) {
  return (
    <Card className="qc-stats-card">
      <p className="qc-stats-card-label">{label}</p>
      <p className="qc-stats-card-value">{value}</p>
      {action ? <div className="qc-stats-card-action">{action}</div> : null}
    </Card>
  );
}
