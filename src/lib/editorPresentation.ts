import { createId } from "./model";
import type {
  ChecklistItem,
  Configuration,
  ItemKind,
  Rule,
  Schedule,
} from "./customizationTypes";

export const ITEM_TYPES: {
  kind: ItemKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "boolean",
    label: "Yes / No",
    description: "A question with two answers",
  },
  {
    kind: "time",
    label: "Time of day",
    description: "For wake-up times and similar goals",
  },
  {
    kind: "duration",
    label: "Time spent",
    description: "An amount of hours and minutes",
  },
  {
    kind: "tasks",
    label: "To-do list",
    description: "Record work on a connected list",
  },
];

export function itemKindLabel(kind: ItemKind): string {
  if (kind === "checkbox") return "Yes / No";
  const previous = {
    number: "Number / counter",
    text: "Text",
    choice: "Choose one",
  };
  return (
    ITEM_TYPES.find((type) => type.kind === kind)?.label ??
    previous[kind as keyof typeof previous] ??
    kind
  );
}
export function originalMainInput(kind: ItemKind): boolean {
  return kind === "checkbox" || ITEM_TYPES.some((type) => type.kind === kind);
}
export function mainInputError(item: ChecklistItem): string {
  return `${item.label || "This question"}: choose Yes / No, Time of day, Time spent, or To-do list. Put notes, counters and choices in Extra questions.`;
}
export function newMainInputError(
  before: Configuration,
  after: Configuration,
): string | undefined {
  const unsupported = after.items.find(
    (item) =>
      !item.deleted &&
      !originalMainInput(item.kind) &&
      before.items.find((old) => old.id === item.id)?.kind !== item.kind,
  );
  return unsupported ? mainInputError(unsupported) : undefined;
}
export function defaultEditorRule(kind: ItemKind): Rule {
  if (kind === "boolean" || kind === "checkbox" || kind === "tasks")
    return { op: "equals", field: "value", value: true };
  if (kind === "time")
    return { op: "compare", field: "value", operator: "lte", value: 600 };
  if (kind === "number" || kind === "duration")
    return { op: "compare", field: "value", operator: "gte", value: 1 };
  return { op: "not-empty", field: "value" };
}
export function editorItem(
  kind: ItemKind,
  blockId: string,
  order: number,
): ChecklistItem {
  return {
    id: createId(),
    blockId,
    label: "",
    kind,
    generation: 1,
    order,
    completion: defaultEditorRule(kind),
    followups: [],
    ...(kind === "choice"
      ? {
          options: [
            { id: createId(), label: "Choice 1" },
            { id: createId(), label: "Choice 2" },
          ],
        }
      : {}),
  };
}
export function duplicateEditorItem(item: ChecklistItem): ChecklistItem {
  const ids = new Map<string, string>(
    item.followups.map((field) => [field.id, createId()]),
  );
  for (const option of [
    ...(item.options ?? []),
    ...item.followups.flatMap((field) => field.options ?? []),
  ])
    ids.set(option.id, createId());
  const rewrite = (value: unknown): unknown =>
    typeof value === "string"
      ? (ids.get(value) ?? value)
      : Array.isArray(value)
        ? value.map(rewrite)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, entry]) => [
                key,
                rewrite(entry),
              ]),
            )
          : value;
  const next = rewrite(structuredClone(item)) as ChecklistItem;
  return {
    ...next,
    id: createId(),
    label: `${item.label} copy`,
    generation: 1,
    legacyKey: undefined,
    inputId: undefined,
    listId: undefined,
    kind:
      item.kind === "tasks" || item.kind === "checkbox" ? "boolean" : item.kind,
    followups: next.followups.map((field) => ({
      ...field,
      preferenceKey: undefined,
      ariaLabel: undefined,
    })),
  };
}
export function normalizeEditorItem(
  original: ChecklistItem | undefined,
  next: ChecklistItem,
): ChecklistItem {
  if (!original) return next;
  const removed = (before?: { id: string }[], after?: { id: string }[]) =>
    before?.some((choice) => !after?.some((value) => value.id === choice.id)) ??
    false;
  const incompatible =
    original.kind !== next.kind ||
    original.listId !== next.listId ||
    removed(original.options, next.options) ||
    next.followups.some((field) =>
      original.followups.some(
        (prior) =>
          prior.id === field.id &&
          (prior.kind !== field.kind || removed(prior.options, field.options)),
      ),
    );
  return {
    ...next,
    generation: original.generation + (incompatible ? 1 : 0),
    legacyKey: incompatible ? undefined : original.legacyKey,
  };
}
export function sortedByOrder<T extends { order: number }>(values: T[]): T[] {
  return [...values].sort((a, b) => a.order - b.order);
}
export function normalizedOrders(configuration: Configuration): Configuration {
  return {
    ...configuration,
    blocks: sortedByOrder(configuration.blocks).map((block, order) => ({
      ...block,
      order,
    })),
    lists: sortedByOrder(configuration.lists).map((list, order) => ({
      ...list,
      order,
    })),
    items: configuration.blocks.flatMap((block) =>
      sortedByOrder(
        configuration.items.filter((item) => item.blockId === block.id),
      ).map((item, order) => ({ ...item, order })),
    ),
  };
}
export function reordered<T extends { id: string; order: number }>(
  values: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const visible = sortedByOrder(values).filter(
    (value) => !("deleted" in value && value.deleted),
  );
  const index = visible.findIndex((value) => value.id === id),
    other = index + direction;
  if (index < 0 || other < 0 || other >= visible.length) return values;
  [visible[index], visible[other]] = [visible[other], visible[index]];
  const order = new Map(visible.map((value, position) => [value.id, position]));
  return values.map((value) =>
    order.has(value.id) ? { ...value, order: order.get(value.id)! } : value,
  );
}
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60),
    minute = Math.round(minutes % 60);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60;
  return [hours ? `${hours}h` : "", remainder || !hours ? `${remainder}m` : ""]
    .filter(Boolean)
    .join(" ");
}
export function summarizeRule(rule: Rule, item: ChecklistItem): string {
  const field =
    "field" in rule
      ? item.followups.find((entry) => entry.id === rule.field)
      : undefined;
  const name =
    "field" in rule && rule.field !== "value"
      ? field?.label || "Extra question"
      : "Answer";
  switch (rule.op) {
    case "always":
      return "Always earns a check";
    case "never":
      return "Never earns a check";
    case "complete":
      return rule.value ? "Item is complete" : "Item is incomplete";
    case "equals": {
      if (rule.field === "value" && typeof rule.value === "boolean")
        return `${rule.value ? "Yes" : "No"} earns a check`;
      const option = (field?.options ?? item.options)?.find(
        (entry) => entry.id === rule.value,
      );
      return `${name} is ${option?.label ?? (rule.value === null ? "unanswered" : String(rule.value))}`;
    }
    case "not-empty":
      return `${name} provided`;
    case "compare": {
      const kind = rule.field === "value" ? item.kind : field?.kind;
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
          ? clockLabel(rule.value)
          : kind === "duration"
            ? durationLabel(rule.value)
            : String(rule.value);
      return `${name} ${words[rule.operator]} ${value}`;
    }
    case "all":
    case "any":
      return (
        rule.rules
          .map((child) => summarizeRule(child, item))
          .join(rule.op === "all" ? " and " : " or ") ||
        (rule.op === "all" ? "Always earns a check" : "Never earns a check")
      );
    case "not":
      return `Not (${summarizeRule(rule.rule, item)})`;
  }
}
export function summarizeSchedule(schedule?: Schedule): string {
  const weekdays = schedule?.weekdays;
  const days =
    !weekdays || weekdays.length === 7
      ? "Every day"
      : weekdays.length === 0
        ? "No scheduled days"
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            .filter((_, day) => weekdays.includes(day))
            .join(", ");
  return [
    days,
    schedule?.startDate ? `from ${schedule.startDate}` : "",
    schedule?.endDate ? `through ${schedule.endDate}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
export function summarizeItem(item: ChecklistItem): string {
  return `${itemKindLabel(item.kind)} · ${summarizeRule(item.completion, item)}`;
}
