import { Button, StatusBadge } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { QuickQuestionConfig, QuickQuestionState } from "@quest-city-web/learning-engines";

export interface QuickQuestionViewProps {
  config: QuickQuestionConfig;
  state: QuickQuestionState;
  onSelectOption: (optionId: string) => void;
  onEnterValue: (value: number) => void;
}

export function QuickQuestionView({ config, state, onSelectOption, onEnterValue }: QuickQuestionViewProps) {
  if (config.mode === "ITEM_SET") {
    const currentIndex = state.currentItemIndex ?? 0;
    const currentItem = config.items[currentIndex];
    const previousResult = state.itemResults && state.itemResults.length > 0 ? state.itemResults[state.itemResults.length - 1] : undefined;

    return (
      <div>
        <p>
          {t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.itemSetProgress", {
            params: { current: Math.min(currentIndex + 1, config.items.length), total: config.items.length },
          })}
        </p>
        {previousResult && (
          <StatusBadge tone={previousResult.correctness === "CORRECT" ? "success" : "warning"}>
            {previousResult.correctness === "CORRECT"
              ? t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultCorrect")
              : t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultIncorrect")}
            {previousResult.feedbackText ? `: ${previousResult.feedbackText}` : ""}
          </StatusBadge>
        )}
        {currentItem && <p>{currentItem.prompt}</p>}
        {currentItem && currentItem.mode === "OPTION_SELECTION" && (
          <fieldset>
            <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.optionsLegend")}</legend>
            {currentItem.options.map((option) => (
              <Button
                key={option.optionId}
                type="button"
                variant={state.selectedOptionId === option.optionId ? "primary" : "secondary"}
                onClick={() => onSelectOption(option.optionId)}
                aria-pressed={state.selectedOptionId === option.optionId}
              >
                {option.text}
              </Button>
            ))}
          </fieldset>
        )}
        {currentItem && currentItem.mode === "ENTER_VALUE" && (
          <fieldset>
            <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.valueInputLabel")}</legend>
            <label>
              {t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.valueInputLabel")}
              <input
                type="number"
                value={state.enteredValue ?? ""}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) onEnterValue(parsed);
                }}
              />
            </label>
          </fieldset>
        )}
        {!currentItem && (
          <p>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.itemSetComplete")}</p>
        )}
      </div>
    );
  }

  if (config.mode === "OPTION_SELECTION") {
    return (
      <fieldset>
        <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.optionsLegend")}</legend>
        {config.options.map((option) => (
          <Button
            key={option.optionId}
            type="button"
            variant={state.selectedOptionId === option.optionId ? "primary" : "secondary"}
            onClick={() => onSelectOption(option.optionId)}
            aria-pressed={state.selectedOptionId === option.optionId}
          >
            {option.optionId}
          </Button>
        ))}
      </fieldset>
    );
  }

  return (
    <fieldset>
      <legend>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.valueInputLabel")}</legend>
      <label>
        {t(STUDENT_WEB_CATALOG_IT_IT, "engines.quick.valueInputLabel")}
        <input
          type="number"
          value={state.enteredValue ?? ""}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onEnterValue(parsed);
          }}
        />
      </label>
    </fieldset>
  );
}
