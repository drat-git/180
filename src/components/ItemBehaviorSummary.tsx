import { useId, useState } from "react";
import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  TodoListDefinition,
} from "../lib/customizationTypes";
import { explainItemBehavior } from "../lib/itemBehavior";

export function ItemBehaviorSummary({
  item,
  block,
  lists,
}: {
  item: ChecklistItem;
  block?: ChecklistBlockDefinition;
  lists: TodoListDefinition[];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const explanation = explainItemBehavior(item, { block, lists });
  const requiredCount = item.followups.filter(
    (field) => field.required && field.condition?.op !== "never",
  ).length;
  const multiple = explanation.followups.length > 1;
  const hasDetails = multiple || explanation.details.length > 0;
  return (
    <section className="editor-behavior" aria-label="How this check works">
      <h3>How this check works</h3>
      <p>{explanation.completion}</p>
      {explanation.followups.length === 1 && <p>{explanation.followups[0]}</p>}
      {multiple && (
        <p>
          This check has {explanation.followups.length} extra questions.
          {requiredCount
            ? ` ${requiredCount} ${requiredCount === 1 ? "is" : "are"} required when shown.`
            : " None are required to earn a check."}
        </p>
      )}
      {hasDetails && (
        <>
          <button
            type="button"
            className="editor-behavior-toggle"
            aria-expanded={expanded}
            aria-controls={`${id}-details`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          <div id={`${id}-details`} hidden={!expanded}>
            <ul>
              {multiple &&
                explanation.followups.map((text, index) => (
                  <li key={item.followups[index].id}>{text}</li>
                ))}
              {explanation.details.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
