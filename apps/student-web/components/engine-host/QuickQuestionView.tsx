import { Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { QuickQuestionConfig, QuickQuestionState } from "@quest-city-web/learning-engines";

export interface QuickQuestionViewProps {
  config: QuickQuestionConfig;
  state: QuickQuestionState;
  onSelectOption: (optionId: string) => void;
  onEnterValue: (value: number) => void;
}

export function QuickQuestionView({ config, state, onSelectOption, onEnterValue }: QuickQuestionViewProps) {
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
