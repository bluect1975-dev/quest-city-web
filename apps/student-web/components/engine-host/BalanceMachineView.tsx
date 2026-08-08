import { Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { BalanceMachineConfig, BalanceMachineState } from "@quest-city-web/learning-engines";

export interface BalanceMachineViewProps {
  config: BalanceMachineConfig;
  state: BalanceMachineState;
  onPlace: (tokenId: string, side: "left" | "right") => void;
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
