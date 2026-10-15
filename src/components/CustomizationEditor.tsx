import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  BriefcaseBusiness,
  Check,
  Circle,
  Compass,
  Copy,
  Dumbbell,
  Heart,
  Home,
  Leaf,
  Plus,
  Star,
  Sun,
  Trash2,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  ChoiceOption,
  Configuration,
  FollowupDefinition,
  ItemAnswer,
  ItemAnswers,
  ItemKind,
  Rule,
  Schedule,
  TodoListDefinition,
} from "../lib/customizationTypes";
import {
  defaultAnswer,
  evaluateItem,
  itemAnswerKey,
  scheduleMatches,
} from "../lib/customization";
import { addDays } from "../lib/dates";
import { createId } from "../lib/model";
import { ChecklistBlock, Modal } from "./Controls";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { ReorderHandle } from "./ReorderHandle";
import "./Customization.css";

const ICONS: Record<string, LucideIcon> = {
  circle: Circle,
  sun: Sun,
  book: BookOpen,
  briefcase: BriefcaseBusiness,
  utensils: Utensils,
  dumbbell: Dumbbell,
  heart: Heart,
  home: Home,
  leaf: Leaf,
  star: Star,
  compass: Compass,
  check: Check,
};
const KINDS: [ItemKind, string][] = [
  ["boolean", "Yes / No"],
  ["checkbox", "Checkbox"],
  ["number", "Number / counter"],
  ["time", "Clock time"],
  ["duration", "Duration"],
  ["text", "Text"],
  ["choice", "Single choice"],
  ["tasks", "Connected To-do list"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const copy = <T,>(value: T): T => structuredClone(value);
const sort = <T extends { order: number }>(values: T[]) =>
  [...values].sort((a, b) => a.order - b.order);
function normalizedOrders(configuration: Configuration): Configuration {
  return {
    ...configuration,
    blocks: sort(configuration.blocks).map((block, order) => ({
      ...block,
      order,
    })),
    lists: sort(configuration.lists).map((list, order) => ({ ...list, order })),
    items: configuration.blocks.flatMap((block) =>
      sort(configuration.items.filter((item) => item.blockId === block.id)).map(
        (item, order) => ({ ...item, order }),
      ),
    ),
  };
}

export function CustomizationIcon({
  name,
  size = 18,
}: {
  name: string;
  size?: number;
}) {
  const Icon =
    ICONS[name] ??
    (name === "graduation-cap"
      ? BookOpen
      : name === "briefcase-business"
        ? BriefcaseBusiness
        : name === "activity"
          ? Dumbbell
          : Circle);
  return <Icon size={size} aria-hidden="true" />;
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={`customization-field${wide ? " customization-wide" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="customization-check">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
function IconSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!ICONS[value] && (
          <option value={value}>{value.replaceAll("-", " ")}</option>
        )}
        {Object.keys(ICONS).map((icon) => (
          <option key={icon} value={icon}>
            {icon[0].toUpperCase() + icon.slice(1)}
          </option>
        ))}
      </select>
    </Field>
  );
}
function reordered<T extends { id: string; order: number }>(
  values: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const visible = sort(values).filter(
    (value) => !("deleted" in value && value.deleted),
  );
  const index = visible.findIndex((value) => value.id === id),
    other = index + direction;
  if (other < 0 || other >= visible.length) return values;
  [visible[index], visible[other]] = [visible[other], visible[index]];
  const positions = new Map(
    visible.map((value, position) => [value.id, position]),
  );
  return values.map((value) =>
    positions.has(value.id)
      ? { ...value, order: positions.get(value.id)! }
      : value,
  );
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule?: Schedule;
  onChange: (value: Schedule) => void;
}) {
  const current = schedule ?? {};
  const weekdays = current.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="customization-fields">
      <fieldset className="customization-weekdays customization-wide">
        <legend>Appears on</legend>
        {DAYS.map((day, index) => (
          <label key={day} className="customization-check">
            <input
              type="checkbox"
              checked={weekdays.includes(index)}
              onChange={(event) =>
                onChange({
                  ...current,
                  weekdays: event.target.checked
                    ? [...weekdays, index].sort()
                    : weekdays.filter((value) => value !== index),
                })
              }
            />
            {day}
          </label>
        ))}
      </fieldset>
      <Field label="First date (optional)">
        <input
          type="date"
          value={current.startDate ?? ""}
          onChange={(event) =>
            onChange({ ...current, startDate: event.target.value || undefined })
          }
        />
      </Field>
      <Field label="Last date (optional)">
        <input
          type="date"
          min={current.startDate}
          value={current.endDate ?? ""}
          onChange={(event) =>
            onChange({ ...current, endDate: event.target.value || undefined })
          }
        />
      </Field>
    </div>
  );
}

function ChoicesEditor({
  options,
  onChange,
  label = "Choices",
}: {
  options: ChoiceOption[];
  onChange: (values: ChoiceOption[]) => void;
  label?: string;
}) {
  return (
    <div className="customization-choices" role="group" aria-label={label}>
      {options.map((option, index) => (
        <div className="customization-row" key={option.id}>
          <input
            aria-label={`${label} ${index + 1}`}
            value={option.label}
            onChange={(event) =>
              onChange(
                options.map((value) =>
                  value.id === option.id
                    ? { ...value, label: event.target.value }
                    : value,
                ),
              )
            }
          />
          <button
            className="customization-small-button"
            type="button"
            aria-label={`Remove ${option.label || "choice"}`}
            onClick={() =>
              onChange(options.filter((value) => value.id !== option.id))
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="customization-small-button"
        onClick={() =>
          onChange([
            ...options,
            { id: createId(), label: `Choice ${options.length + 1}` },
          ])
        }
      >
        Add choice
      </button>
    </div>
  );
}

function defaultRule(kind: ItemKind): Rule {
  if (kind === "boolean" || kind === "checkbox" || kind === "tasks")
    return { op: "equals", field: "value", value: true };
  if (kind === "time")
    return { op: "compare", field: "value", operator: "lte", value: 600 };
  if (kind === "number" || kind === "duration")
    return { op: "compare", field: "value", operator: "gte", value: 1 };
  return { op: "not-empty", field: "value" };
}

function RuleEditor({
  rule,
  item,
  onChange,
  condition = false,
  depth = 0,
}: {
  rule: Rule;
  item: ChecklistItem;
  onChange: (value: Rule) => void;
  condition?: boolean;
  depth?: number;
}) {
  const fields = [
    {
      id: "value",
      label: "Main answer",
      kind: item.kind,
      options: item.options,
    },
    ...item.followups
      .filter((field) => field.kind !== "occurrences")
      .map((field) => ({
        id: field.id,
        label: field.label || "Follow-up",
        kind:
          field.kind === "counter"
            ? "number"
            : field.kind === "note"
              ? "text"
              : "choice",
        options: field.options,
      })),
  ];
  const field =
    "field" in rule
      ? (fields.find((candidate) => candidate.id === rule.field) ?? fields[0])
      : fields[0];
  const currentField = "field" in rule ? rule.field : "value";
  const mode =
    rule.op === "complete" ? (rule.value ? "complete" : "incomplete") : rule.op;
  function newMode(value: string) {
    if (value === "complete" || value === "incomplete")
      onChange({ op: "complete", value: value === "complete" });
    else if (value === "equals")
      onChange({
        op: "equals",
        field: currentField,
        value:
          field.kind === "boolean" ||
          field.kind === "checkbox" ||
          field.kind === "tasks"
            ? true
            : "",
      });
    else if (value === "compare")
      onChange({
        op: "compare",
        field: currentField,
        operator: "gte",
        value: 1,
      });
    else if (value === "not-empty")
      onChange({ op: "not-empty", field: currentField });
    else if (value === "all" || value === "any")
      onChange({ op: value, rules: [defaultRule(item.kind)] });
    else if (value === "not")
      onChange({ op: "not", rule: defaultRule(item.kind) });
    else onChange({ op: value as "always" | "never" });
  }
  function setField(id: string) {
    if ("field" in rule) onChange({ ...rule, field: id });
  }
  const boolean =
    field.kind === "boolean" ||
    field.kind === "checkbox" ||
    field.kind === "tasks";
  return (
    <div className="customization-rule">
      <div className="customization-fields">
        <Field
          label={
            condition
              ? "Show when"
              : depth
                ? "Condition"
                : "Counts as complete when"
          }
        >
          <select
            aria-label={
              condition ? "Follow-up visibility rule" : "Completion rule"
            }
            value={mode}
            onChange={(event) => newMode(event.target.value)}
          >
            <option value="equals">Answer equals</option>
            <option value="compare">Number / time threshold</option>
            <option value="not-empty">Has an answer</option>
            <option value="all">All conditions match</option>
            <option value="any">Any condition matches</option>
            <option value="not">Condition does not match</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
            {condition && (
              <>
                <option value="complete">Item is complete</option>
                <option value="incomplete">Item is incomplete</option>
              </>
            )}
          </select>
        </Field>
        {"field" in rule && (
          <Field label="Answer field">
            <select
              value={rule.field}
              onChange={(event) => setField(event.target.value)}
            >
              {fields.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {rule.op === "equals" && (
          <Field label="Required answer">
            {boolean ? (
              <select
                value={rule.value === null ? "null" : String(rule.value)}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    value:
                      event.target.value === "null"
                        ? null
                        : event.target.value === "true",
                  })
                }
              >
                <option value="true">Yes / checked</option>
                <option value="false">No / unchecked</option>
                <option value="null">Unanswered</option>
              </select>
            ) : field.kind === "choice" ? (
              <select
                value={String(rule.value ?? "")}
                onChange={(event) =>
                  onChange({ ...rule, value: event.target.value || null })
                }
              >
                <option value="">Choose a choice</option>
                {field.options?.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  field.kind === "number" || field.kind === "duration"
                    ? "number"
                    : field.kind === "time"
                      ? "time"
                      : "text"
                }
                value={String(rule.value ?? "")}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    value:
                      field.kind === "number" || field.kind === "duration"
                        ? Number(event.target.value)
                        : event.target.value,
                  })
                }
              />
            )}
          </Field>
        )}
        {rule.op === "compare" && (
          <>
            <Field label="Threshold comparison">
              <select
                value={rule.operator}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    operator: event.target.value as
                      "lt" | "lte" | "eq" | "gte" | "gt",
                  })
                }
              >
                <option value="lt">Less than / before</option>
                <option value="lte">At most / at or before</option>
                <option value="eq">Exactly</option>
                <option value="gte">At least / at or after</option>
                <option value="gt">More than / after</option>
              </select>
            </Field>
            <Field
              label={
                field.kind === "duration"
                  ? "Threshold (minutes)"
                  : field.kind === "time"
                    ? "Threshold time"
                    : "Threshold"
              }
            >
              <input
                type={field.kind === "time" ? "time" : "number"}
                value={
                  field.kind === "time"
                    ? `${String(Math.floor(rule.value / 60)).padStart(2, "0")}:${String(rule.value % 60).padStart(2, "0")}`
                    : rule.value
                }
                onChange={(event) =>
                  onChange({
                    ...rule,
                    value:
                      field.kind === "time"
                        ? event.target.value
                            .split(":")
                            .reduce(
                              (sum, part, index) =>
                                sum + Number(part) * (index === 0 ? 60 : 1),
                              0,
                            )
                        : Number(event.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
      </div>
      {(rule.op === "all" || rule.op === "any") && (
        <div className="customization-followups">
          {rule.rules.map((child, index) => (
            <div className="customization-section" key={index}>
              <RuleEditor
                rule={child}
                item={item}
                depth={depth + 1}
                condition={condition}
                onChange={(next) =>
                  onChange({
                    ...rule,
                    rules: rule.rules.map((value, position) =>
                      position === index ? next : value,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="customization-small-button"
                onClick={() =>
                  onChange({
                    ...rule,
                    rules: rule.rules.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                Remove condition
              </button>
            </div>
          ))}
          <button
            type="button"
            className="customization-small-button"
            onClick={() =>
              onChange({
                ...rule,
                rules: [...rule.rules, defaultRule(item.kind)],
              })
            }
          >
            Add condition
          </button>
        </div>
      )}
      {rule.op === "not" && (
        <div className="customization-section">
          <RuleEditor
            rule={rule.rule}
            item={item}
            depth={depth + 1}
            condition={condition}
            onChange={(next) => onChange({ op: "not", rule: next })}
          />
        </div>
      )}
    </div>
  );
}

function FollowupEditor({
  followup,
  item,
  onChange,
  onRemove,
}: {
  followup: FollowupDefinition;
  item: ChecklistItem;
  onChange: (value: FollowupDefinition) => void;
  onRemove: () => void;
}) {
  return (
    <details className="customization-section" open>
      <summary>
        {followup.label || "Follow-up"} · {followup.kind}
      </summary>
      <div className="customization-fields">
        <Field label="Follow-up label">
          <input
            value={followup.label}
            onChange={(event) =>
              onChange({ ...followup, label: event.target.value })
            }
          />
        </Field>
        <Field label="Follow-up type">
          <select
            value={followup.kind}
            onChange={(event) =>
              onChange({
                ...followup,
                kind: event.target.value as FollowupDefinition["kind"],
              })
            }
          >
            <option value="note">Note / description</option>
            <option value="counter">Counter</option>
            <option value="choice">Required / optional choice</option>
            <option value="occurrences">Note for each occurrence</option>
          </select>
        </Field>
        {(followup.kind === "note" || followup.kind === "occurrences") && (
          <Field label="Placeholder text" wide>
            <input
              value={followup.placeholder ?? ""}
              onChange={(event) =>
                onChange({ ...followup, placeholder: event.target.value })
              }
            />
          </Field>
        )}
        {followup.kind === "counter" && (
          <>
            <Field label="Minimum">
              <input
                type="number"
                value={followup.min ?? 1}
                onChange={(event) =>
                  onChange({ ...followup, min: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Maximum (optional)">
              <input
                type="number"
                value={followup.max ?? ""}
                onChange={(event) =>
                  onChange({
                    ...followup,
                    max:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Initial count">
              <input
                type="number"
                value={
                  typeof followup.defaultValue === "number"
                    ? followup.defaultValue
                    : (followup.min ?? 1)
                }
                onChange={(event) =>
                  onChange({
                    ...followup,
                    defaultValue: Number(event.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
        {followup.kind === "occurrences" && (
          <Field label="Use this count">
            <select
              value={followup.countField ?? "value"}
              onChange={(event) =>
                onChange({ ...followup, countField: event.target.value })
              }
            >
              {item.kind === "number" && (
                <option value="value">Main answer</option>
              )}
              {item.followups
                .filter((value) => value.kind === "counter")
                .map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.label}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      {followup.kind === "choice" && (
        <>
          <ChoicesEditor
            options={followup.options ?? []}
            onChange={(options) => onChange({ ...followup, options })}
          />
          <Toggle
            label="Show the selected choice as the item label"
            value={!!followup.displayChoiceLabel}
            onChange={(displayChoiceLabel) =>
              onChange({ ...followup, displayChoiceLabel })
            }
          />
          <Toggle
            label="Require a fresh choice whenever the main answer changes"
            value={!!followup.resetOnAnswer}
            onChange={(resetOnAnswer) =>
              onChange({ ...followup, resetOnAnswer })
            }
          />
        </>
      )}
      {followup.kind !== "counter" && (
        <Toggle
          label="Required for completion when shown"
          value={!!followup.required}
          onChange={(required) => onChange({ ...followup, required })}
        />
      )}
      {(followup.kind === "note" || followup.kind === "occurrences") && (
        <Toggle
          label="Expand the note initially"
          value={followup.initiallyExpanded ?? true}
          onChange={(initiallyExpanded) =>
            onChange({ ...followup, initiallyExpanded })
          }
        />
      )}
      <RuleEditor
        item={item}
        rule={followup.condition ?? { op: "always" }}
        condition
        onChange={(condition) => onChange({ ...followup, condition })}
      />
      <button
        type="button"
        className="customization-small-button customization-danger"
        onClick={onRemove}
      >
        Remove follow-up
      </button>
    </details>
  );
}

function newItem(
  blockId: string,
  order: number,
  kind: ItemKind = "boolean",
): ChecklistItem {
  return {
    id: createId(),
    blockId,
    label: "New item",
    kind,
    generation: 1,
    order,
    completion: defaultRule(kind),
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
function duplicateItem(item: ChecklistItem): ChecklistItem {
  const identifiers = new Map<string, string>(
    item.followups.map((field) => [field.id, createId()]),
  );
  for (const option of [
    ...(item.options ?? []),
    ...item.followups.flatMap((field) => field.options ?? []),
  ])
    identifiers.set(option.id, createId());
  const rewrite = (value: unknown): unknown =>
    typeof value === "string"
      ? (identifiers.get(value) ?? value)
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
  const duplicate = rewrite(copy(item)) as ChecklistItem;
  return {
    ...duplicate,
    followups: duplicate.followups.map((field) => ({
      ...field,
      preferenceKey: undefined,
      ariaLabel: undefined,
    })),
    id: createId(),
    label: `${item.label} copy`,
    generation: 1,
    legacyKey: undefined,
    inputId: undefined,
    listId: undefined,
    kind: item.kind === "tasks" ? "boolean" : item.kind,
  };
}

function answerGeneration(
  original: ChecklistItem | undefined,
  next: ChecklistItem,
): ChecklistItem {
  if (!original) return next;
  const missingChoices = (before?: ChoiceOption[], after?: ChoiceOption[]) =>
    before?.some(
      (option) => !after?.some((nextOption) => nextOption.id === option.id),
    ) ?? false;
  const incompatible =
    original.kind !== next.kind ||
    original.listId !== next.listId ||
    missingChoices(original.options, next.options) ||
    next.followups.some((field) =>
      original.followups.some(
        (prior) =>
          prior.id === field.id &&
          (prior.kind !== field.kind ||
            missingChoices(prior.options, field.options)),
      ),
    );
  return {
    ...next,
    generation: original.generation + (incompatible ? 1 : 0),
    legacyKey: incompatible ? undefined : original.legacyKey,
  };
}

function ItemEditor({
  item,
  original,
  blocks,
  lists,
  onChange,
  fixedKind = false,
}: {
  item: ChecklistItem;
  original?: ChecklistItem;
  blocks: ChecklistBlockDefinition[];
  lists: TodoListDefinition[];
  onChange: (value: ChecklistItem) => void;
  fixedKind?: boolean;
}) {
  return (
    <>
      <div className="customization-fields">
        <Field label="Item label" wide>
          <input
            value={item.label}
            onChange={(event) =>
              onChange({ ...item, label: event.target.value })
            }
          />
        </Field>
        <Field label="Input type">
          <select
            value={item.kind}
            disabled={fixedKind}
            onChange={(event) => {
              const kind = event.target.value as ItemKind;
              onChange({
                ...item,
                kind,
                generation:
                  kind === original?.kind
                    ? original.generation
                    : (original?.generation ?? item.generation) + 1,
                completion: defaultRule(kind),
                ...(kind === "choice" && !item.options?.length
                  ? { options: [{ id: createId(), label: "Choice 1" }] }
                  : {}),
                ...(kind !== "tasks" ? { listId: undefined } : {}),
              });
            }}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Block">
          <select
            value={item.blockId}
            onChange={(event) =>
              onChange({
                ...item,
                blockId: event.target.value,
                order: Number.MAX_SAFE_INTEGER,
              })
            }
          >
            {blocks.map((block) => (
              <option value={block.id} key={block.id}>
                {block.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subtext / instructions (optional)" wide>
          <input
            value={item.helper ?? ""}
            onChange={(event) =>
              onChange({ ...item, helper: event.target.value })
            }
          />
        </Field>
        {(item.kind === "number" || item.kind === "duration") && (
          <>
            <Field
              label={
                item.kind === "duration" ? "Minimum minutes" : "Minimum value"
              }
            >
              <input
                type="number"
                value={item.min ?? 0}
                onChange={(event) =>
                  onChange({ ...item, min: Number(event.target.value) })
                }
              />
            </Field>
            <Field
              label={
                item.kind === "duration"
                  ? "Maximum minutes (optional)"
                  : "Maximum value (optional)"
              }
            >
              <input
                type="number"
                value={item.max ?? ""}
                onChange={(event) =>
                  onChange({
                    ...item,
                    max:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </Field>
            {item.kind === "number" && (
              <Field label="Counter increment">
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={item.step ?? 1}
                  onChange={(event) =>
                    onChange({ ...item, step: Number(event.target.value) })
                  }
                />
              </Field>
            )}
          </>
        )}
        {item.kind === "tasks" && (
          <>
            <Field label="Connected To-do list">
              <select
                value={item.listId ?? ""}
                onChange={(event) =>
                  onChange({ ...item, listId: event.target.value })
                }
              >
                <option value="">Choose a list</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Question visibility">
              <select
                value={item.visibility ?? "relevant"}
                onChange={(event) =>
                  onChange({
                    ...item,
                    visibility: event.target.value as "always" | "relevant",
                  })
                }
              >
                <option value="relevant">Show when relevant</option>
                <option value="always">Always show on scheduled days</option>
              </select>
            </Field>
          </>
        )}
      </div>
      {item.kind === "choice" && (
        <ChoicesEditor
          options={item.options ?? []}
          onChange={(options) => onChange({ ...item, options })}
        />
      )}
      {original && original.kind !== item.kind && (
        <p className="customization-status">
          Changing input type starts a blank answer version. Previous answers
          remain available.
        </p>
      )}
      <details className="customization-section" open>
        <summary>Completion rule</summary>
        <RuleEditor
          item={item}
          rule={item.completion}
          onChange={(completion) => onChange({ ...item, completion })}
        />
        <p className="customization-muted">
          Use “All conditions match” for a range; use “Any condition matches”
          for alternatives. Each item is worth one check.
        </p>
      </details>
      <details className="customization-section">
        <summary>Schedule</summary>
        <ScheduleEditor
          schedule={item.schedule}
          onChange={(schedule) => onChange({ ...item, schedule })}
        />
      </details>
      <details className="customization-section">
        <summary>Follow-up fields ({item.followups.length})</summary>
        {item.followups.map((followup) => (
          <FollowupEditor
            key={followup.id}
            item={item}
            followup={followup}
            onChange={(next) =>
              onChange({
                ...item,
                followups: item.followups.map((value) =>
                  value.id === next.id ? next : value,
                ),
              })
            }
            onRemove={() =>
              onChange({
                ...item,
                followups: item.followups.filter(
                  (value) => value.id !== followup.id,
                ),
              })
            }
          />
        ))}
        <div className="customization-toolbar">
          {(["note", "counter", "choice", "occurrences"] as const).map(
            (kind) => (
              <button
                type="button"
                className="customization-small-button"
                key={kind}
                onClick={() =>
                  onChange({
                    ...item,
                    followups: [
                      ...item.followups,
                      {
                        id: createId(),
                        kind,
                        label:
                          kind === "note"
                            ? "Why?"
                            : kind === "counter"
                              ? "How many times?"
                              : kind === "choice"
                                ? "Choose one"
                                : "Occurrence",
                        condition: {
                          op: "equals",
                          field: "value",
                          value: true,
                        },
                        ...(kind === "choice"
                          ? {
                              options: [{ id: createId(), label: "Choice 1" }],
                              required: true,
                            }
                          : {}),
                        ...(kind === "counter"
                          ? { min: 1, defaultValue: 1 }
                          : {}),
                        ...(kind === "occurrences"
                          ? {
                              countField:
                                item.followups.find(
                                  (value) => value.kind === "counter",
                                )?.id ?? "value",
                            }
                          : {}),
                      },
                    ],
                  })
                }
              >
                Add {kind === "occurrences" ? "occurrence notes" : kind}
              </button>
            ),
          )}
        </div>
      </details>
    </>
  );
}

export interface CustomizationEditorProps {
  configuration: Configuration;
  today: string;
  baseRevision: number;
  initialDraft?: Configuration;
  answers?: ItemAnswers;
  relevance?: Record<string, boolean>;
  retainedListChanges?: TodoListDefinition[];
  onDraftChange?: (configuration: Configuration) => void;
  onSave: (
    configuration: Configuration,
    effectiveDate: string,
    baseRevision: number,
  ) => Promise<void> | void;
  onClose: () => void;
}

export function CustomizationEditor({
  configuration,
  today,
  baseRevision,
  initialDraft,
  answers = {},
  relevance = {},
  retainedListChanges = [],
  onDraftChange,
  onSave,
  onClose,
}: CustomizationEditorProps) {
  const [draft, setDraft] = useState(() => copy(initialDraft ?? configuration));
  const reorderSnapshot = useRef<Configuration | null>(null);
  const startReorder = () => {
    reorderSnapshot.current = draft;
  };
  const endReorder = (cancelled: boolean) => {
    if (cancelled && reorderSnapshot.current) setDraft(reorderSnapshot.current);
    reorderSnapshot.current = null;
  };
  const [previewDate, setPreviewDate] = useState(today);
  const [previewAnswers, setPreviewAnswers] = useState<ItemAnswers>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const originalRevision = useState(baseRevision)[0];
  const scope = useId();
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  const blocks = sort(draft.blocks.filter((block) => !block.deleted));
  const lists = sort(draft.lists.filter((list) => !list.deleted));
  function blockChange(next: ChecklistBlockDefinition) {
    setDraft((value) => ({
      ...value,
      blocks: value.blocks.map((block) =>
        block.id === next.id ? next : block,
      ),
    }));
  }
  function itemChange(next: ChecklistItem) {
    const original = configuration.items.find((item) => item.id === next.id);
    const priorDraft = draft.items.find((item) => item.id === next.id);
    if (priorDraft?.blockId !== next.blockId)
      next = {
        ...next,
        order:
          Math.max(
            -1,
            ...draft.items
              .filter((item) => item.blockId === next.blockId)
              .map((item) => item.order),
          ) + 1,
      };
    const normalized = answerGeneration(original, next);
    setDraft((value) => ({
      ...value,
      items: value.items.map((item) =>
        item.id === next.id ? normalized : item,
      ),
    }));
  }
  const todaysItems = (config: Configuration) =>
    config.items.filter((item) => {
      const block = config.blocks.find(
        (candidate) => candidate.id === item.blockId,
      );
      if (!block) return false;
      return evaluateItem(
        item,
        answers[itemAnswerKey(item)] ?? defaultAnswer(item),
        today,
        {
          block,
          relevant: relevance[item.id] ?? relevance[item.listId ?? ""] ?? false,
        },
      ).visible;
    });
  const before = todaysItems(configuration),
    after = todaysItems(draft);
  const completed = (items: ChecklistItem[]) =>
    items.filter(
      (item) =>
        evaluateItem(item, answers[itemAnswerKey(item)] ?? defaultAnswer(item))
          .complete,
    ).length;
  async function save(date: string) {
    setBusy(true);
    setError("");
    try {
      await onSave(normalizedOrders(draft), date, originalRevision);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Customize checklist"
      className="customization-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="customization-intro">
        Build blocks and questions around your routine. Past days keep their
        original checklist. Changes stay in your draft until you save.
      </p>
      {retainedListChanges.length > 0 && (
        <section
          className="customization-section"
          aria-label="Retained To-do list changes"
        >
          <h3>Your retained To-do list changes</h3>
          <p>
            These list changes apply immediately. Your checklist changes will
            use the today or next-day option you choose when saving.
          </p>
          <ul>
            {retainedListChanges.map((list) => (
              <li key={list.id}>
                {list.title}
                {list.deleted ? " · removed from active lists" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="customization-layout">
        <div className="customization-controls">
          {blocks.length === 0 && (
            <p className="customization-empty">
              Start by adding a block, then add your first item.
            </p>
          )}
          {blocks.map((block, blockIndex) => {
            const items = sort(
              draft.items.filter(
                (item) => item.blockId === block.id && !item.deleted,
              ),
            );
            return (
              <section
                className="customization-section"
                data-reorder-card="block"
                aria-label={`Edit ${block.title}`}
                key={block.id}
              >
                <div className="customization-row">
                  <h3 className="customization-item-label">
                    <CustomizationIcon name={block.icon} />
                    {block.title || "Untitled block"}
                  </h3>
                  <div className="customization-toolbar">
                    <ReorderHandle
                      label={block.title || "block"}
                      first={blockIndex === 0}
                      last={blockIndex === blocks.length - 1}
                      onStart={startReorder}
                      onEnd={endReorder}
                      onMove={(direction) =>
                        setDraft((value) => ({
                          ...value,
                          blocks: reordered(value.blocks, block.id, direction),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="customization-small-button customization-danger"
                      aria-label={`Remove block ${block.title}`}
                      onClick={() => {
                        if (
                          items.length &&
                          !window.confirm(
                            `Remove ${block.title} and its ${items.length} items from the checklist? Past days are retained.`,
                          )
                        )
                          return;
                        setDraft((value) => ({
                          ...value,
                          blocks: value.blocks.map((candidate) =>
                            candidate.id === block.id
                              ? { ...candidate, deleted: true }
                              : candidate,
                          ),
                          items: value.items.map((item) =>
                            item.blockId === block.id
                              ? { ...item, deleted: true }
                              : item,
                          ),
                        }));
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="customization-fields">
                  <Field label="Block title">
                    <input
                      value={block.title}
                      onChange={(event) =>
                        blockChange({ ...block, title: event.target.value })
                      }
                    />
                  </Field>
                  <IconSelect
                    label="Block icon"
                    value={block.icon}
                    onChange={(icon) => blockChange({ ...block, icon })}
                  />
                </div>
                <details className="customization-section">
                  <summary>Block schedule</summary>
                  <ScheduleEditor
                    schedule={block.schedule}
                    onChange={(schedule) => blockChange({ ...block, schedule })}
                  />
                </details>
                <div className="customization-item-list">
                  {items.map((item, itemIndex) => (
                    <details
                      className="customization-section"
                      data-reorder-card="item"
                      key={item.id}
                    >
                      <summary className="customization-item-summary">
                        <span>
                          {item.label || "Untitled item"}{" "}
                          <span className="customization-muted">
                            ·{" "}
                            {KINDS.find(([value]) => value === item.kind)?.[1]}
                          </span>
                        </span>
                        <ReorderHandle
                          label={item.label || "item"}
                          first={itemIndex === 0}
                          last={itemIndex === items.length - 1}
                          onStart={startReorder}
                          onEnd={endReorder}
                          onMove={(direction) =>
                            setDraft((value) => {
                              const group = reordered(
                                value.items.filter(
                                  (candidate) => candidate.blockId === block.id,
                                ),
                                item.id,
                                direction,
                              );
                              return {
                                ...value,
                                items: value.items.map(
                                  (candidate) =>
                                    group.find(
                                      (next) => next.id === candidate.id,
                                    ) ?? candidate,
                                ),
                              };
                            })
                          }
                        />
                      </summary>
                      <div className="customization-toolbar">
                        <button
                          type="button"
                          className="customization-small-button"
                          onClick={() => {
                            const duplicate = duplicateItem(item);
                            setDraft((value) => ({
                              ...value,
                              items: [
                                ...value.items,
                                { ...duplicate, order: items.length },
                              ],
                            }));
                          }}
                        >
                          <Copy size={14} />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="customization-small-button customization-danger"
                          onClick={() => itemChange({ ...item, deleted: true })}
                        >
                          <Trash2 size={14} />
                          Remove item
                        </button>
                      </div>
                      <ItemEditor
                        item={item}
                        original={configuration.items.find(
                          (value) => value.id === item.id,
                        )}
                        blocks={blocks}
                        lists={lists.filter(
                          (list) =>
                            list.id === item.listId ||
                            !draft.items.some(
                              (candidate) =>
                                !candidate.deleted &&
                                candidate.id !== item.id &&
                                candidate.listId === list.id &&
                                candidate.kind === "tasks",
                            ),
                        )}
                        onChange={itemChange}
                      />
                    </details>
                  ))}
                </div>
                <button
                  type="button"
                  className="customization-small-button"
                  onClick={() =>
                    setDraft((value) => ({
                      ...value,
                      items: [...value.items, newItem(block.id, items.length)],
                    }))
                  }
                >
                  <Plus size={14} /> Add item to {block.title}
                </button>
              </section>
            );
          })}
          <button
            type="button"
            className="customization-small-button"
            onClick={() =>
              setDraft((value) => ({
                ...value,
                blocks: [
                  ...value.blocks,
                  {
                    id: createId(),
                    title: "New block",
                    icon: "circle",
                    order: blocks.length,
                  },
                ],
              }))
            }
          >
            <Plus size={14} /> Add block
          </button>
        </div>
        <aside
          className="customization-preview"
          aria-label="Checklist live preview"
        >
          <div className="customization-preview-title">
            <h3>Live preview</h3>
            <button
              className="customization-small-button"
              type="button"
              onClick={() => setPreviewAnswers({})}
            >
              Reset examples
            </button>
          </div>
          <div className="customization-fields">
            <Field label="Preview date" wide>
              <input
                type="date"
                value={previewDate}
                onChange={(event) =>
                  setPreviewDate(event.target.value || today)
                }
              />
            </Field>
          </div>
          <p className="customization-muted">
            Try example answers here. These never change your daily records.
            Connected questions are shown as an example.
          </p>
          {blocks
            .filter((block) => scheduleMatches(block.schedule, previewDate))
            .map((block) => {
              const items = sort(
                draft.items.filter(
                  (item) =>
                    item.blockId === block.id &&
                    !item.deleted &&
                    scheduleMatches(item.schedule, previewDate),
                ),
              );
              if (!items.length) return null;
              return (
                <ChecklistBlock
                  key={block.id}
                  title={block.title || "Untitled block"}
                  preferenceKey={`${scope}:${block.id}`}
                  collapsible={false}
                  icon={<CustomizationIcon name={block.icon} />}
                  progress={{
                    total: items.length,
                    completed: items.filter(
                      (item) =>
                        evaluateItem(
                          item,
                          previewAnswers[itemAnswerKey(item)] ??
                            defaultAnswer(item),
                        ).complete,
                    ).length,
                  }}
                >
                  {items.map((item) => (
                    <ChecklistItemInput
                      key={itemAnswerKey(item)}
                      item={item}
                      answer={
                        previewAnswers[itemAnswerKey(item)] ??
                        defaultAnswer(item)
                      }
                      preferencePrefix={`preview:${scope}`}
                      preview
                      onChange={(answer) =>
                        setPreviewAnswers((values) => ({
                          ...values,
                          [itemAnswerKey(item)]: answer,
                        }))
                      }
                      taskContent={
                        <p className="customization-muted">
                          Your{" "}
                          {lists.find((list) => list.id === item.listId)
                            ?.title ?? "connected list"}{" "}
                          tasks appear here.
                        </p>
                      }
                    />
                  ))}
                </ChecklistBlock>
              );
            })}
        </aside>
      </div>
      <div className="customization-save">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {publishing ? (
          <>
            <p>
              Today changes from{" "}
              <strong>
                {completed(before)}/{before.length}
              </strong>{" "}
              to{" "}
              <strong>
                {completed(after)}/{after.length}
              </strong>{" "}
              checks using compatible saved answers. New input versions start
              blank. Earlier days remain unchanged.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPublishing(false)}
              >
                Back to draft
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(addDays(today, 1))}
              >
                {busy ? "Saving…" : "Start next day"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save(today)}
              >
                {busy ? "Saving…" : "Apply today"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Removing items keeps their earlier answers. You’ll choose when the
              new checklist starts before saving.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Discard the unsaved checklist draft?"))
                    return;
                  setDraft(copy(configuration));
                  setPreviewAnswers({});
                  setError("");
                }}
              >
                Discard draft
              </button>
              <button type="button" disabled={busy} onClick={onClose}>
                Keep draft & close
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setPublishing(true);
                }}
              >
                Review changes
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export interface ManageTodoListsProps {
  configuration: Configuration;
  initialLists?: TodoListDefinition[];
  reviewRetainedLists?: boolean;
  hasRetainedChecklistChanges?: boolean;
  onReviewChecklist?: () => void;
  today: string;
  baseRevision: number;
  onSaveLists: (
    lists: TodoListDefinition[],
    baseRevision: number,
  ) => Promise<void> | void;
  onSaveConnection: (
    configuration: Configuration,
    effectiveDate: string,
    baseRevision: number,
  ) => Promise<void> | void;
  onClose: () => void;
}

export function ManageTodoLists({
  configuration,
  initialLists,
  reviewRetainedLists = false,
  hasRetainedChecklistChanges = false,
  onReviewChecklist,
  today,
  baseRevision,
  onSaveLists,
  onSaveConnection,
  onClose,
}: ManageTodoListsProps) {
  const [lists, setLists] = useState(() =>
    copy(initialLists ?? configuration.lists),
  );
  const reorderSnapshot = useRef<TodoListDefinition[] | null>(null);
  const [listDraft, setListDraft] = useState<TodoListDefinition | null>(null);
  const [connection, setConnection] = useState<ChecklistItem | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = sort(lists.filter((list) => !list.deleted)),
    archived = sort(lists.filter((list) => list.deleted));
  const blocks = sort(configuration.blocks.filter((block) => !block.deleted));
  useEffect(() => {
    setLists(copy(initialLists ?? configuration.lists));
  }, [configuration.lists, initialLists]);
  async function saveLists(next: TodoListDefinition[]) {
    setBusy(true);
    setError("");
    try {
      await onSaveLists(next, baseRevision);
      setLists(next);
      setListDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save lists. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveConnection(date: string) {
    if (!connection) return;
    setBusy(true);
    setError("");
    const items = configuration.items.some((item) => item.id === connection.id)
      ? configuration.items.map((item) =>
          item.id === connection.id ? connection : item,
        )
      : [...configuration.items, connection];
    try {
      await onSaveConnection(
        normalizedOrders({ ...configuration, lists, items }),
        date,
        baseRevision,
      );
      setConnection(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save connection. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Manage To-do lists"
      className="customization-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="customization-intro">
        List changes apply immediately. Removing a list archives its tasks while
        keeping their history. Daily question changes can start today or next
        day.
      </p>
      {reviewRetainedLists && (
        <section
          className="customization-section"
          aria-label="Retained list changes"
        >
          <h3>Review retained list changes</h3>
          <p>
            Your saved draft is shown below. Save these list changes to apply
            them immediately before editing daily connections.
          </p>
          {hasRetainedChecklistChanges && (
            <p>
              Your checklist changes will stay in a separate draft so you can
              still choose today or next day.
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void saveLists(lists)}
            >
              {busy ? "Saving…" : "Save retained list changes"}
            </button>
          </div>
        </section>
      )}
      {!reviewRetainedLists && hasRetainedChecklistChanges && (
        <section
          className="customization-section"
          aria-label="Retained checklist draft"
        >
          <p>
            You also have an unsaved checklist draft. Review it to choose when
            those changes start.
          </p>
          {onReviewChecklist && (
            <button
              type="button"
              className="customization-small-button"
              disabled={busy}
              onClick={onReviewChecklist}
            >
              Review checklist draft
            </button>
          )}
        </section>
      )}
      {active.map((list, index) => (
        <section
          className="customization-section"
          data-reorder-card="list"
          key={list.id}
        >
          <div className="customization-row">
            <h3 className="customization-item-label">
              <CustomizationIcon name={list.icon} />
              {list.title}
            </h3>
            <div className="customization-toolbar">
              <ReorderHandle
                label={`${list.title} list`}
                first={index === 0}
                last={index === active.length - 1}
                disabled={busy}
                onStart={() => {
                  reorderSnapshot.current = lists;
                }}
                onEnd={(cancelled, moved) => {
                  if (cancelled && reorderSnapshot.current)
                    setLists(reorderSnapshot.current);
                  else if (moved) void saveLists(lists);
                  reorderSnapshot.current = null;
                }}
                onMove={(direction) =>
                  setLists((current) => reordered(current, list.id, direction))
                }
              />
              <button
                type="button"
                className="customization-small-button"
                disabled={busy}
                onClick={() => {
                  setConnection(null);
                  setListDraft(copy(list));
                }}
              >
                Edit list
              </button>
              <button
                type="button"
                className="customization-small-button customization-danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${list.title} from active lists? Its tasks and past accomplishments will be retained.`,
                    )
                  )
                    void saveLists(
                      lists.map((value) =>
                        value.id === list.id
                          ? { ...value, deleted: true }
                          : value,
                      ),
                    );
                }}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="customization-toolbar">
            <button
              type="button"
              className="customization-small-button"
              disabled={busy || !blocks.length || reviewRetainedLists}
              onClick={() => {
                setListDraft(null);
                const current = configuration.items.find(
                  (item) =>
                    !item.deleted &&
                    item.kind === "tasks" &&
                    item.listId === list.id,
                );
                setConnection(
                  current
                    ? copy(current)
                    : {
                        ...newItem(
                          blocks[0].id,
                          configuration.items.filter(
                            (item) =>
                              item.blockId === blocks[0].id && !item.deleted,
                          ).length,
                          "tasks",
                        ),
                        label: `Worked on ${list.title} tasks?`,
                        listId: list.id,
                        visibility: "relevant",
                        followups: [
                          {
                            id: createId(),
                            kind: "note",
                            label: "Why?",
                            condition: {
                              op: "equals",
                              field: "value",
                              value: false,
                            },
                            initiallyExpanded: true,
                          },
                        ],
                      },
                );
              }}
            >
              {configuration.items.some(
                (item) =>
                  !item.deleted &&
                  item.kind === "tasks" &&
                  item.listId === list.id,
              )
                ? "Edit daily question"
                : "Connect to daily checklist"}
            </button>
          </div>
        </section>
      ))}
      <button
        type="button"
        className="customization-small-button"
        disabled={busy}
        onClick={() => {
          setConnection(null);
          setListDraft({
            id: createId(),
            title: "",
            icon: "circle",
            order: active.length,
          });
        }}
      >
        <Plus size={14} /> Add To-do list
      </button>
      {listDraft && (
        <section className="customization-section" aria-label="List editor">
          <h3>
            {lists.some((list) => list.id === listDraft.id)
              ? "Edit list"
              : "New list"}
          </h3>
          <div className="customization-fields">
            <Field label="List title">
              <input
                value={listDraft.title}
                autoFocus
                onChange={(event) =>
                  setListDraft({ ...listDraft, title: event.target.value })
                }
              />
            </Field>
            <IconSelect
              label="List icon"
              value={listDraft.icon}
              onChange={(icon) => setListDraft({ ...listDraft, icon })}
            />
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setListDraft(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !listDraft.title.trim()}
              onClick={() =>
                void saveLists(
                  lists.some((list) => list.id === listDraft.id)
                    ? lists.map((list) =>
                        list.id === listDraft.id
                          ? { ...listDraft, title: listDraft.title.trim() }
                          : list,
                      )
                    : [
                        ...lists,
                        { ...listDraft, title: listDraft.title.trim() },
                      ],
                )
              }
            >
              {busy ? "Saving…" : "Save list"}
            </button>
          </div>
        </section>
      )}
      {connection && (
        <section
          className="customization-section"
          aria-label="Daily question connection"
        >
          <h3>Daily question</h3>
          <ItemEditor
            item={connection}
            fixedKind
            original={configuration.items.find(
              (item) => item.id === connection.id,
            )}
            blocks={blocks}
            lists={active.filter((list) => list.id === connection.listId)}
            onChange={(next) =>
              setConnection(
                answerGeneration(
                  configuration.items.find((item) => item.id === connection.id),
                  {
                    ...next,
                    kind: "tasks",
                    listId: connection.listId,
                  },
                ),
              )
            }
          />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConnection(null)}
            >
              Cancel
            </button>
            {configuration.items.some((item) => item.id === connection.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setConnection({ ...connection, deleted: !connection.deleted })
                }
              >
                {connection.deleted ? "Keep connection" : "Disconnect question"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveConnection(addDays(today, 1))}
            >
              Start next day
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void saveConnection(today)}
            >
              Apply today
            </button>
          </div>
          {connection.deleted && (
            <p className="customization-status">
              This daily question will be removed from the chosen date. Its past
              answers remain available.
            </p>
          )}
        </section>
      )}
      {archived.length > 0 && (
        <details className="customization-section">
          <summary>Removed lists ({archived.length})</summary>
          {archived.map((list) => (
            <div className="customization-row" key={list.id}>
              <span>{list.title}</span>
              <button
                type="button"
                className="customization-small-button"
                disabled={busy}
                onClick={() =>
                  void saveLists(
                    lists.map((value) =>
                      value.id === list.id
                        ? { ...value, deleted: false, order: active.length }
                        : value,
                    ),
                  )
                }
              >
                Restore {list.title}
              </button>
            </div>
          ))}
        </details>
      )}
      {!blocks.length && (
        <p className="customization-status">
          Create a checklist block before connecting a list to a daily question.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/** Kept separate from editable inputs so reviewing an old schema never rewrites it. */
export function PreviousAnswerView({
  item,
  answer,
}: {
  item: ChecklistItem;
  answer: ItemAnswer;
}) {
  return (
    <div className="customization-readonly-answers">
      <ChecklistItemInput
        item={item}
        answer={answer}
        locked
        onChange={() => {}}
        preferencePrefix="previous-answer"
      />
      {answer.selections.length > 0 && (
        <ul>
          {answer.selections.map((selection) => (
            <li key={selection.taskId}>
              {selection.title}
              {selection.children.length
                ? `: ${selection.children.map((child) => child.title).join(", ")}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
