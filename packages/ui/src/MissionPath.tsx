import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type MissionPathNodeState = "completed" | "current" | "available" | "locked";

export interface MissionPathStop {
  id: string;
  /** Small label above the title, e.g. a stage number or a stage-specific state ("Tappa 2 · sei qui") — this, not color alone, is what distinguishes state for assistive tech (07_04 §13). */
  eyebrow?: ReactNode;
  title: ReactNode;
  state: MissionPathNodeState;
  /** A CTA / status pill for this stop, rendered at the row's end (e.g. a "Riprendi" button or a status badge). */
  action?: ReactNode;
}

export interface MissionPathProps {
  stops: MissionPathStop[];
}

/**
 * A real journey through connected waypoints (UAT Failure Remediation,
 * `UAT-RC4-VISUAL-DIRECTION-01`) — "Il mio percorso" was previously a
 * flat list of pills; this renders a genuine route: nodes connected by a
 * line, each carrying one of the four real `MyPathItem.pathState` values
 * (never an invented visual-only state). An `<ol>` so assistive tech
 * announces position/count, `aria-current="step"` on the current stop,
 * and every state also carries a real icon or text (never color alone).
 */
export function MissionPath({ stops }: MissionPathProps) {
  return (
    <ol className="qc-mission-stops">
      {stops.map((stop) => (
        <li key={stop.id} className={`qc-mission-stop is-${stop.state}`} aria-current={stop.state === "current" ? "step" : undefined}>
          <span className="qc-mission-node">
            {stop.state === "completed" ? <Icon name="check" /> : null}
            {stop.state === "current" ? <Icon name="flag" /> : null}
            {stop.state === "locked" ? <Icon name="lock" /> : null}
          </span>
          <div className="qc-mission-card">
            <div>
              {stop.eyebrow ? <p className="qc-mission-card-eyebrow">{stop.eyebrow}</p> : null}
              <h4>{stop.title}</h4>
            </div>
            {stop.action}
          </div>
        </li>
      ))}
    </ol>
  );
}
