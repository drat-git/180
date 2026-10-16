import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  Rule,
  Schedule,
  TodoListDefinition,
} from "./customizationTypes";
import { clockLabel, summarizeSchedule } from "./editorPresentation";

export interface ItemBehaviorExplanation {
  completion: string;
  followups: string[];
  details: string[];
}

interface BehaviorContext {
  block?: ChecklistBlockDefinition;
  lists?: readonly TodoListDefinition[];
}

const quote = (text: string | undefined, fallback: string) =>
  `“${text?.trim() || fallback}”`;
const amount = (value: number) =>
  Number.isFinite(value) ? String(value) : "a goal that has not been set";
const sentence = (text: string) => (/[.!?]”?$/.test(text) ? text : `${text}.`);
function duration(value: number): string {
  if (!Number.isFinite(value)) return "a duration that has not been set";
  const hours = Math.floor(value / 60),
    minutes = value % 60;
  return [
    hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    minutes || !hours
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
      : "",
  ]
    .filter(Boolean)
    .join(" and ");
}
const time = (value: number) =>
  Number.isFinite(value) ? clockLabel(value) : "a time that has not been set";

/** Explain definitions only. This never evaluates or changes a daily answer. */
export function explainItemBehavior(
  item: ChecklistItem,
  { block, lists = [] }: BehaviorContext = {},
): ItemBehaviorExplanation {
  const list = lists.find((entry) => entry.id === item.listId);
  const listName = list?.title?.trim()
    ? quote(list.title, "Unnamed list")
    : "the connected To-do list";
  const fieldFor = (id: string) =>
    item.followups.find((entry) => entry.id === id);
  const fieldName = (id: string) =>
    id === "value"
      ? "your main answer"
      : id === "selections"
        ? "your selected tasks"
        : fieldFor(id)
          ? quote(fieldFor(id)?.label, "Unnamed extra question")
          : "an extra question that has not been set up";
  function optionName(field: string, value: string) {
    const options = field === "value" ? item.options : fieldFor(field)?.options;
    const option = options?.find((entry) => entry.id === value);
    return option
      ? quote(option.label, "Unnamed choice")
      : "a choice that is missing or has been removed";
  }
  function predicate(rule: Rule, visibility = false, nested = false): string {
    switch (rule.op) {
      case "always":
        return "the condition is always satisfied";
      case "never":
        return "the condition is never satisfied";
      case "complete":
        // The evaluator passes the main rule result to visibility conditions.
        // Inside the main rule itself, this flag is always false.
        return visibility
          ? `your main completion condition ${rule.value ? "matches" : "does not match"}`
          : `the condition is ${rule.value ? "never" : "always"} satisfied`;
      case "all":
      case "any": {
        if (!rule.rules.length)
          return `the condition is ${rule.op === "all" ? "always" : "never"} satisfied`;
        if (rule.rules.length === 1)
          return predicate(rule.rules[0], visibility, nested);
        const text = rule.rules
          .map((child) => predicate(child, visibility, true))
          .join(rule.op === "all" ? " and " : " or ");
        return nested ? `(${text})` : text;
      }
      case "not":
        return `it is not the case that (${predicate(rule.rule, visibility)})`;
      case "not-empty":
        return rule.field === "value"
          ? item.kind === "tasks" ||
            item.kind === "boolean" ||
            item.kind === "checkbox"
            ? "you answer Yes or No"
            : item.kind === "choice"
              ? "you choose an answer"
              : item.kind === "text"
                ? "you provide a nonblank answer"
                : "you provide an answer"
          : rule.field === "selections"
            ? "you select at least one task"
            : `${fieldName(rule.field)} has ${fieldFor(rule.field)?.kind === "note" ? "nonblank text" : "an answer"}`;
      case "equals": {
        const main = rule.field === "value";
        const kind = main ? item.kind : fieldFor(rule.field)?.kind;
        if (rule.value === null)
          return main
            ? "your main answer is unanswered"
            : `${fieldName(rule.field)} is explicitly cleared`;
        if (typeof rule.value === "boolean") {
          if (main && item.kind === "tasks")
            return rule.value
              ? `you record work on ${listName}`
              : `you answer No to working on ${listName}`;
          if (main && (item.kind === "boolean" || item.kind === "checkbox"))
            return `you answer ${rule.value ? "Yes" : "No"}`;
          return `${fieldName(rule.field)} is ${rule.value ? "Yes" : "No"}`;
        }
        if (typeof rule.value === "string") {
          if (kind === "choice")
            return main
              ? `you choose ${optionName(rule.field, rule.value)}`
              : `${fieldName(rule.field)} is ${optionName(rule.field, rule.value)}`;
          if (kind === "time" && /^\d{2}:\d{2}$/.test(rule.value)) {
            const [hours, minutes] = rule.value.split(":").map(Number);
            return `${main ? "you enter a time of" : `${fieldName(rule.field)} is`} ${time(hours * 60 + minutes)}`;
          }
          const value =
            rule.value === ""
              ? "empty text"
              : rule.value.trim()
                ? `“${rule.value}”`
                : "the configured whitespace";
          return main
            ? `you enter exactly ${value}`
            : `${fieldName(rule.field)} is exactly ${value}`;
        }
        const value =
          kind === "duration" ? duration(rule.value) : amount(rule.value);
        return main
          ? `you enter exactly ${value}`
          : `${fieldName(rule.field)} is exactly ${value}`;
      }
      case "compare": {
        const main = rule.field === "value";
        const kind = main ? item.kind : fieldFor(rule.field)?.kind;
        const words =
          kind === "time"
            ? {
                lt: "before",
                lte: "at or before",
                eq: "at",
                gte: "at or after",
                gt: "after",
              }
            : {
                lt: "less than",
                lte: "at most",
                eq: "exactly",
                gte: "at least",
                gt: "more than",
              };
        const value =
          kind === "time"
            ? time(rule.value)
            : kind === "duration"
              ? duration(rule.value)
              : amount(rule.value);
        return `${main ? (kind === "time" ? "you enter a time" : "you enter") : `${fieldName(rule.field)} is`} ${words[rule.operator]} ${value}`;
      }
    }
  }
  const required = item.followups.some(
    (field) => field.required && field.condition?.op !== "never",
  );
  const main = predicate(item.completion);
  const completion =
    item.completion.op === "never" ||
    (item.completion.op === "complete" && item.completion.value)
      ? "This item never earns a check with its current completion condition."
      : item.completion.op === "always" ||
          (item.completion.op === "complete" && !item.completion.value)
        ? required
          ? "Whenever this item is shown, you earn a check after completing every required extra question that appears."
          : "You earn a check whenever this item is shown."
        : `You earn a check when ${required && ["all", "any"].includes(item.completion.op) ? `(${main})` : main}${required ? " and you complete every required extra question that appears" : ""}.`;
  const details: string[] = [];
  const followups = item.followups.map((field) => {
    const name = quote(field.label, "Unnamed extra question");
    const ask =
      field.kind === "occurrences"
        ? `we’ll ask for a separate ${name} note for each count in ${field.countField === "value" && item.label.trim() ? quote(item.label, "Main answer") : fieldName(field.countField ?? "count")}`
        : `we’ll ask ${name}`;
    const condition = field.condition;
    const text =
      condition?.op === "never"
        ? `${name} is never shown with its current condition.`
        : !condition || condition.op === "always"
          ? sentence(`Whenever this item is shown, ${ask}`)
          : sentence(`If ${predicate(condition, true)}, ${ask}`);
    if (condition?.op !== "never") {
      if (field.kind === "occurrences") {
        details.push(
          `${name} displays one note per whole count, up to 1,000 notes. A blank or zero count displays no notes.${field.required ? " To satisfy this required question, the count must be a positive whole number and every counted note must contain text; a count above 1,000 cannot be fully entered here." : " These notes are optional."}`,
        );
      }
      if (field.kind === "counter") {
        const limits = inputLimits(field.min, field.max, amount);
        if (limits) details.push(`Allowed answers for ${name}: ${limits}.`);
        if (field.required)
          details.push(
            `${name} requires a number within its allowed limits; 0 qualifies when allowed.`,
          );
      }
      if (field.kind === "choice" && field.required)
        details.push(
          `${name} requires one of its listed choices when it appears.`,
        );
      if (field.kind === "note" && field.required)
        details.push(
          `${name} requires text other than spaces when it appears.`,
        );
    }
    if (field.resetOnAnswer) {
      const hasDefault =
        field.defaultValue !== undefined && field.defaultValue !== null;
      details.push(
        `${name} ${hasDefault ? "returns to its configured starting value" : "is cleared"} whenever you change or clear the main answer.${field.kind === "choice" && !hasDefault ? " You must choose again for the new answer." : ""}`,
      );
    }
    if (field.displayChoiceLabel)
      details.push(
        `A selected choice from ${name} replaces the item’s question text when its display condition applies.`,
      );
    return `${text}${condition?.op === "never" ? "" : field.required ? " This extra answer is required when it appears." : field.kind !== "occurrences" ? " This extra answer is optional." : ""}`;
  });
  if (nondefaultSchedule(item.schedule))
    details.unshift(`Item schedule: ${summarizeSchedule(item.schedule)}.`);
  if (block && nondefaultSchedule(block.schedule))
    details.unshift(
      `Block schedule for ${quote(block.title, "Unnamed block")}: ${summarizeSchedule(block.schedule)}. The item must also fit this schedule.`,
    );
  if (item.kind === "number" || item.kind === "duration") {
    const limits = inputLimits(
      item.min ?? (item.max !== undefined ? 0 : undefined),
      item.max,
      item.kind === "duration" ? duration : amount,
    );
    if (limits)
      details.push(
        `Allowed answers: ${limits}. These limits control what you can enter; they do not replace the completion goal.`,
      );
    if (item.kind === "number" && item.step !== undefined && item.step !== 1)
      details.push(
        `Counter buttons change the answer by ${amount(item.step)}.`,
      );
  }
  if (item.kind === "tasks") {
    details.push(
      item.visibility === "always"
        ? `The question for ${listName} always appears on its scheduled days.`
        : `On scheduled days, the question for ${listName} appears when the list has unfinished tasks for that day, completed tasks recorded that day, or a main answer, selected tasks, or nonempty notes already saved.`,
    );
    if (!list || list.deleted)
      details.push(
        !list
          ? "Choose an available To-do list to finish this connection."
          : "The connected list is archived.",
      );
  }
  if (
    item.followups.some(
      (field) =>
        !field.resetOnAnswer &&
        field.condition &&
        !["always", "never"].includes(field.condition.op),
    )
  )
    details.push(
      "Extra answers are kept when hidden, except those explicitly set to reset when the main answer changes.",
    );
  const hasNegation = (rule: Rule): boolean =>
    rule.op === "not" ||
    ((rule.op === "all" || rule.op === "any") && rule.rules.some(hasNegation));
  if (
    [
      item.completion,
      ...item.followups.flatMap((field) =>
        field.condition ? [field.condition] : [],
      ),
    ].some(hasNegation)
  )
    details.push(
      "A negated condition can match an unanswered input. “Not Yes” is different from “No,” and a negated threshold is not simply the opposite threshold.",
    );
  return { completion, followups, details: [...new Set(details)] };
}

function inputLimits(
  min: number | undefined,
  max: number | undefined,
  format: (value: number) => string,
): string {
  return min !== undefined && max !== undefined
    ? `${format(min)} through ${format(max)}, inclusive`
    : min !== undefined
      ? `at least ${format(min)}`
      : max !== undefined
        ? `at most ${format(max)}`
        : "";
}

function nondefaultSchedule(schedule?: Schedule): boolean {
  return (
    !!schedule &&
    !!(
      schedule.startDate ||
      schedule.endDate ||
      (schedule.weekdays && schedule.weekdays.length !== 7)
    )
  );
}
