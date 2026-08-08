import { useState } from "react";
import { Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { DragDropConfig, DragDropState } from "@quest-city-web/learning-engines";

export interface DragAndDropViewProps {
  config: DragDropConfig;
  state: DragDropState;
  onPlace: (itemId: string, targetId: string) => void;
}

/**
 * Select-source-then-select-destination (§31 mandatory keyboard fallback,
 * implemented here as the ONLY interaction path — see BalanceMachineView
 * for the same rationale). Selecting an item, then a target, dispatches
 * one PLACE_ITEM/MOVE_ITEM action — identical semantics to what a pointer
 * drag would have produced.
 */
export function DragAndDropView({ config, state, onPlace }: DragAndDropViewProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  function handleTargetClick(targetId: string) {
    if (!selectedItemId) return;
    onPlace(selectedItemId, targetId);
    setSelectedItemId(null);
  }

  return (
    <div className="qc-engine-drag">
      <fieldset>
        <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.drag.itemsLegend")}</legend>
        {config.items.map((item) => (
          <Button
            key={item.itemId}
            type="button"
            variant={selectedItemId === item.itemId ? "primary" : "secondary"}
            onClick={() => setSelectedItemId(item.itemId)}
            aria-pressed={selectedItemId === item.itemId}
          >
            {item.itemId} {state.placements[item.itemId] ? `→ ${state.placements[item.itemId]}` : ""}
          </Button>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.drag.targetsLegend")}</legend>
        {config.targets.map((target) => (
          <Button
            key={target.targetId}
            type="button"
            variant="secondary"
            disabled={!selectedItemId}
            onClick={() => handleTargetClick(target.targetId)}
          >
            {target.targetId}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
