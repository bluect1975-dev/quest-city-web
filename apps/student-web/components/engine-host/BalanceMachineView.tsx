import { Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { BalanceMachineConfig, BalanceMachineState } from "@quest-city-web/learning-engines";

export interface BalanceMachineViewProps {
  config: BalanceMachineConfig;
  state: BalanceMachineState;
  onPlace: (tokenId: string, side: "left" | "right") => void;
}

const MAX_TILT_DEGREES = 18;
const PIVOT_X = 120;
const PIVOT_Y = 58;

/**
 * Pilot Product Experience Remediation Tranche G6 (`UX-BALANCE-VISUAL-01`,
 * closing the gap the mission's own final report initially overstated as
 * already fixed — see `FINDING_BALANCE_MACHINE_NO_VISUAL_TREATMENT.md`).
 * Purely decorative (`aria-hidden`) — every fact it shows (which side is
 * heavier, by how much) is already conveyed by the real text above/below
 * it (§24: illustration complementary, never a replacement for the
 * existing button/keyboard interaction or the screen-reader-visible
 * state). The beam tilts by a bounded angle derived from the *relative*
 * weight difference (not an unbounded absolute one) so one very heavy
 * token can't rotate the beam past a legible angle. Uses a CSS
 * `transition` (not a JS animation loop) so the pre-existing global
 * `prefers-reduced-motion` reset (`packages/ui/src/styles.css`) already
 * disables it for free — no separate reduced-motion branch needed here.
 */
function BalanceMachineIllustration({ leftWeight, rightWeight }: { leftWeight: number; rightWeight: number }) {
  const totalWeight = leftWeight + rightWeight;
  const tiltRatio = totalWeight > 0 ? (rightWeight - leftWeight) / totalWeight : 0;
  const tiltDegrees = Math.max(-MAX_TILT_DEGREES, Math.min(MAX_TILT_DEGREES, tiltRatio * MAX_TILT_DEGREES));
  const isBalanced = totalWeight > 0 && leftWeight === rightWeight;

  return (
    <svg className="qc-balance-svg" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      <polygon className="qc-balance-base" points="104,148 136,148 120,60" />
      <g
        className="qc-balance-beam-group"
        style={{ transform: `rotate(${tiltDegrees}deg)`, transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px` }}
      >
        <line className="qc-balance-beam" x1="48" y1={PIVOT_Y} x2="192" y2={PIVOT_Y} />
        <line className="qc-balance-string" x1="48" y1={PIVOT_Y} x2="48" y2="96" />
        <line className="qc-balance-string" x1="192" y1={PIVOT_Y} x2="192" y2="96" />
        <path className="qc-balance-pan" d="M22,96 Q48,120 74,96 Z" />
        <path className="qc-balance-pan" d="M166,96 Q192,120 218,96 Z" />
        <text className="qc-balance-pan-value" x="48" y="112">
          {leftWeight}
        </text>
        <text className="qc-balance-pan-value" x="192" y="112">
          {rightWeight}
        </text>
      </g>
      <circle className={`qc-balance-pivot${isBalanced ? " qc-balance-pivot-balanced" : ""}`} cx={PIVOT_X} cy={PIVOT_Y} r="5" />
    </svg>
  );
}

/**
 * Selection-based placement (button per token/side) rather than native
 * pointer drag — this is a deliberate design choice, not a fallback bolted
 * onto a separate drag implementation: buttons are natively keyboard-
 * operable (Tab + Enter/Space), pointer/touch-operable (click/tap), and
 * screen-reader-operable by construction, so no second interaction path is
 * needed to satisfy §20's "drag cannot be the only method" (there is no
 * drag-only method here to begin with).
 */
export function BalanceMachineView({ config, state, onPlace }: BalanceMachineViewProps) {
  const leftTokens = config.tokens.filter((token) => state.placements[token.tokenId] === "left");
  const rightTokens = config.tokens.filter((token) => state.placements[token.tokenId] === "right");
  const leftWeight = leftTokens.reduce((sum, token) => sum + token.weight, 0);
  const rightWeight = rightTokens.reduce((sum, token) => sum + token.weight, 0);

  return (
    <div className="qc-engine-balance">
      <BalanceMachineIllustration leftWeight={leftWeight} rightWeight={rightWeight} />
      <div className="qc-engine-balance-sides">
        <section aria-label={t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.leftSide")}>
          <h3>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.leftSide")}</h3>
          <p>{leftWeight}</p>
          <ul>
            {leftTokens.map((token) => (
              <li key={token.tokenId}>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.tokenLabel", { params: { weight: token.weight } })}</li>
            ))}
          </ul>
        </section>
        <section aria-label={t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.rightSide")}>
          <h3>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.rightSide")}</h3>
          <p>{rightWeight}</p>
          <ul>
            {rightTokens.map((token) => (
              <li key={token.tokenId}>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.tokenLabel", { params: { weight: token.weight } })}</li>
            ))}
          </ul>
        </section>
      </div>
      <fieldset>
        <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.name")}</legend>
        {config.tokens.map((token) => (
          <div key={token.tokenId} className="qc-engine-token-row">
            <span>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.tokenLabel", { params: { weight: token.weight } })}</span>
            <Button
              type="button"
              variant={state.placements[token.tokenId] === "left" ? "primary" : "secondary"}
              onClick={() => onPlace(token.tokenId, "left")}
            >
              {t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.placeLeftButton")}
            </Button>
            <Button
              type="button"
              variant={state.placements[token.tokenId] === "right" ? "primary" : "secondary"}
              onClick={() => onPlace(token.tokenId, "right")}
            >
              {t(STUDENT_WEB_CATALOG_IT_IT, "engines.balance.placeRightButton")}
            </Button>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
