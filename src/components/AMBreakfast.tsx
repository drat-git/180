import {
  breakfastAnswerPatch,
  breakfastComplete,
  breakfastLabel,
  breakfastLabels,
  type BreakfastChoice,
  type DailyData,
  type EntryPatch,
} from "../lib/model";
import { BinaryAnswer, CollapsibleText, Reason } from "./Controls";

export function AMBreakfast({
  data,
  locked,
  onAttempt,
  onPatch,
}: {
  data: DailyData;
  locked: boolean;
  onAttempt: () => void;
  onPatch: (patch: EntryPatch) => void;
}) {
  const { status, choice } = data.amBreakfast;
  const label =
    status === true && choice ? breakfastLabels[choice] : breakfastLabel;
  return (
    <div className="field">
      <div className="field-line">
        <span className="field-label">{label}</span>
        <BinaryAnswer
          label={label}
          value={status}
          completed={breakfastComplete(data)}
          onChange={(answer) =>
            onPatch(breakfastAnswerPatch(data.amBreakfast, answer))
          }
        />
      </div>
      {status === true && choice === null && (
        <fieldset className="breakfast-choice">
          <legend>Choose one (required)</legend>
          {(["shake", "meal"] as BreakfastChoice[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="am-breakfast-choice"
                value={value}
                required
                checked={false}
                onChange={() =>
                  onPatch({ amBreakfast: { status: true, choice: value } })
                }
              />
              {breakfastLabels[value]}
            </label>
          ))}
        </fieldset>
      )}
      {status === true && choice === "meal" && (
        <CollapsibleText
          label="What did you eat?"
          ariaLabel="Calorie dense meal food description"
          preferenceKey="am-breakfast-food-description"
          addLabel="What did you eat? Add description"
          viewLabel="View food description"
          initiallyExpanded
          placeholder="Just a quick description"
          value={data.amBreakfastDescription}
          locked={locked}
          onAttempt={onAttempt}
          onChange={(value) => onPatch({ amBreakfastDescription: value })}
        />
      )}
      {status === false && (
        <Reason
          label={breakfastLabel}
          value={data.amBreakfastReason}
          locked={locked}
          onAttempt={onAttempt}
          onChange={(value) => onPatch({ amBreakfastReason: value })}
        />
      )}
    </div>
  );
}
