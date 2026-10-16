import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  FollowupDefinition,
  ItemKind,
  Rule,
  TodoListDefinition,
} from "../lib/customizationTypes";
import { createId } from "../lib/model";
import {
  defaultEditorRule,
  ITEM_TYPES,
  itemKindLabel,
  originalMainInput,
  summarizeRule,
} from "../lib/editorPresentation";
import { ChoicesEditor, Field, ScheduleEditor, Toggle } from "./EditorFields";
import { ItemBehaviorSummary } from "./ItemBehaviorSummary";

export function RuleEditor({
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
      label: item.label || "This question",
      kind: item.kind,
      options: item.options,
    },
    ...item.followups
      .filter((field) => field.kind !== "occurrences")
      .map((field) => ({
        id: field.id,
        label: field.label || "Extra question",
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
      onChange({ op: value, rules: [defaultEditorRule(item.kind)] });
    else if (value === "not")
      onChange({ op: "not", rule: defaultEditorRule(item.kind) });
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
    <div className="editor-rule">
      <div className="editor-fields">
        <Field
          label={condition ? "Show when" : depth ? "Condition" : "Custom rule"}
        >
          <select
            aria-label={condition ? "Show when" : "Custom completion rule"}
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
          <Field label="Question to check">
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
            <Field label="Comparison">
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
        <div className="editor-rule-children">
          {rule.rules.map((child, index) => (
            <div className="editor-rule-child" key={index}>
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
                className="editor-small-button"
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
            className="editor-small-button"
            onClick={() =>
              onChange({
                ...rule,
                rules: [...rule.rules, defaultEditorRule(item.kind)],
              })
            }
          >
            Add condition
          </button>
        </div>
      )}
      {rule.op === "not" && (
        <div className="editor-rule-child">
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

type NumericGoal =
  | { mode: "gte" | "lte" | "eq"; value: number }
  | { mode: "between"; min: number; max: number };
function numericGoal(rule: Rule): NumericGoal | undefined {
  if (
    rule.op === "compare" &&
    rule.field === "value" &&
    ["gte", "lte", "eq"].includes(rule.operator)
  )
    return { mode: rule.operator as "gte" | "lte" | "eq", value: rule.value };
  if (rule.op === "all" && rule.rules.length === 2) {
    const low = rule.rules.find(
      (child) =>
        child.op === "compare" &&
        child.field === "value" &&
        child.operator === "gte",
    );
    const high = rule.rules.find(
      (child) =>
        child.op === "compare" &&
        child.field === "value" &&
        child.operator === "lte",
    );
    if (low?.op === "compare" && high?.op === "compare")
      return { mode: "between", min: low.value, max: high.value };
  }
  return undefined;
}
function goalRule(goal: NumericGoal): Rule {
  return goal.mode === "between"
    ? {
        op: "all",
        rules: [
          { op: "compare", field: "value", operator: "gte", value: goal.min },
          { op: "compare", field: "value", operator: "lte", value: goal.max },
        ],
      }
    : { op: "compare", field: "value", operator: goal.mode, value: goal.value };
}
function AmountInput({
  label,
  value,
  duration,
  onChange,
}: {
  label: string;
  value: number;
  duration: boolean;
  onChange: (value: number) => void;
}) {
  if (!duration)
    return (
      <Field label={label}>
        <input
          type="number"
          step="any"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </Field>
    );
  return (
    <fieldset className="editor-duration">
      <legend>{label}</legend>
      <Field label={`${label} hours`}>
        <input
          type="number"
          min="0"
          step="1"
          value={Math.floor(value / 60)}
          onChange={(event) =>
            onChange(Number(event.target.value) * 60 + (value % 60))
          }
        />
      </Field>
      <Field label={`${label} minutes`}>
        <input
          type="number"
          min="0"
          max="59"
          step="1"
          value={value % 60}
          onChange={(event) =>
            onChange(Math.floor(value / 60) * 60 + Number(event.target.value))
          }
        />
      </Field>
    </fieldset>
  );
}
function SimpleCompletion({
  item,
  onChange,
  onCustom,
}: {
  item: ChecklistItem;
  onChange: (rule: Rule) => void;
  onCustom: () => void;
}) {
  const rule = item.completion;
  if (
    (item.kind === "boolean" || item.kind === "checkbox") &&
    rule.op === "equals" &&
    rule.field === "value" &&
    typeof rule.value === "boolean"
  )
    return (
      <Field label="Earn a check when">
        <select
          value={String(rule.value)}
          onChange={(event) =>
            onChange({ ...rule, value: event.target.value === "true" })
          }
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </Field>
    );
  if (
    item.kind === "tasks" &&
    rule.op === "equals" &&
    rule.field === "value" &&
    rule.value === true
  )
    return (
      <Field label="Earn a check when">
        <span className="editor-static-value">
          Worked on the connected list
        </span>
      </Field>
    );
  if (item.kind === "text" && rule.op === "not-empty" && rule.field === "value")
    return (
      <Field label="Earn a check when">
        <span className="editor-static-value">Answer provided</span>
      </Field>
    );
  if (item.kind === "number" || item.kind === "duration") {
    const goal = numericGoal(rule);
    if (goal)
      return (
        <>
          <Field label="Earn a check when">
            <select
              value={goal.mode}
              onChange={(event) => {
                const mode = event.target.value as NumericGoal["mode"],
                  value = goal.mode === "between" ? goal.min : goal.value;
                onChange(
                  goalRule(
                    mode === "between"
                      ? {
                          mode,
                          min: value,
                          max: goal.mode === "between" ? goal.max : value,
                        }
                      : { mode, value },
                  ),
                );
              }}
            >
              <option value="gte">At least</option>
              <option value="lte">At most</option>
              <option value="eq">Exactly</option>
              <option value="between">Between</option>
            </select>
          </Field>
          {goal.mode === "between" ? (
            <>
              <AmountInput
                label="Minimum goal"
                value={goal.min}
                duration={item.kind === "duration"}
                onChange={(min) => onChange(goalRule({ ...goal, min }))}
              />
              <AmountInput
                label="Maximum goal"
                value={goal.max}
                duration={item.kind === "duration"}
                onChange={(max) => onChange(goalRule({ ...goal, max }))}
              />
            </>
          ) : (
            <AmountInput
              label="Goal"
              value={goal.value}
              duration={item.kind === "duration"}
              onChange={(value) => onChange(goalRule({ ...goal, value }))}
            />
          )}
        </>
      );
  }
  if (
    item.kind === "time" &&
    rule.op === "compare" &&
    rule.field === "value" &&
    rule.operator !== "eq"
  )
    return (
      <>
        <Field label="Earn a check when">
          <select
            value={rule.operator}
            onChange={(event) =>
              onChange({
                ...rule,
                operator: event.target.value as "lt" | "lte" | "gte" | "gt",
              })
            }
          >
            <option value="lt">Before</option>
            <option value="lte">At or before</option>
            <option value="gte">At or after</option>
            <option value="gt">After</option>
          </select>
        </Field>
        <Field label="Goal time">
          <input
            type="time"
            value={`${String(Math.floor(rule.value / 60)).padStart(2, "0")}:${String(rule.value % 60).padStart(2, "0")}`}
            onChange={(event) => {
              const [hours, minutes] = event.target.value
                .split(":")
                .map(Number);
              if (Number.isFinite(hours) && Number.isFinite(minutes))
                onChange({ ...rule, value: hours * 60 + minutes });
            }}
          />
        </Field>
      </>
    );
  if (item.kind === "choice") {
    const choiceRule = (candidate: Rule) =>
      candidate.op === "equals" &&
      candidate.field === "value" &&
      typeof candidate.value === "string" &&
      item.options?.some((option) => option.id === candidate.value);
    const anyAnswer = rule.op === "not-empty" && rule.field === "value";
    if (
      anyAnswer ||
      choiceRule(rule) ||
      (rule.op === "any" && rule.rules.every(choiceRule)) ||
      rule.op === "never"
    ) {
      const selected = anyAnswer
        ? (item.options?.map((option) => option.id) ?? [])
        : rule.op === "equals"
          ? [rule.value]
          : rule.op === "any"
            ? rule.rules.flatMap((child) =>
                child.op === "equals" ? [child.value] : [],
              )
            : [];
      return (
        <fieldset className="editor-qualifying editor-field-wide">
          <legend>Earn a check when choosing…</legend>
          {item.options?.map((option) => (
            <Toggle
              key={option.id}
              label={option.label || "Untitled choice"}
              value={selected.includes(option.id)}
              onChange={(checked) => {
                const values = checked
                  ? [...selected, option.id]
                  : selected.filter((value) => value !== option.id);
                const rules: Rule[] = values.map((value) => ({
                  op: "equals",
                  field: "value",
                  value,
                }));
                onChange(
                  rules.length === 1
                    ? rules[0]
                    : rules.length
                      ? { op: "any", rules }
                      : { op: "never" },
                );
              }}
            />
          ))}
        </fieldset>
      );
    }
  }
  return (
    <div className="editor-field-wide">
      <span className="editor-label">Earn a check when…</span>
      <button type="button" className="editor-small-button" onClick={onCustom}>
        Edit custom conditions
      </button>
    </div>
  );
}

function conditionSummary(rule: Rule | undefined, item: ChecklistItem): string {
  if (!rule || rule.op === "always") return "always";
  if (
    rule.op === "equals" &&
    rule.field === "value" &&
    typeof rule.value === "boolean"
  )
    return rule.value ? "Yes" : "No";
  return summarizeRule(rule, item).replace(/ earns a check$/, "");
}
function extraLabel(kind: FollowupDefinition["kind"]): string {
  return kind === "note"
    ? "Note"
    : kind === "counter"
      ? "Counter"
      : kind === "choice"
        ? "Choice"
        : "Notes for each count";
}
function newExtra(
  item: ChecklistItem,
  kind: FollowupDefinition["kind"],
): FollowupDefinition {
  return {
    id: createId(),
    kind,
    label:
      kind === "note"
        ? "Why?"
        : kind === "counter"
          ? "How many times?"
          : kind === "choice"
            ? "Choose one"
            : "Details",
    condition: ["boolean", "checkbox", "tasks"].includes(item.kind)
      ? { op: "equals", field: "value", value: true }
      : { op: "always" },
    ...(kind === "choice"
      ? { options: [{ id: createId(), label: "Choice 1" }], required: true }
      : {}),
    ...(kind === "counter" ? { min: 1, defaultValue: 1 } : {}),
    ...(kind === "occurrences"
      ? {
          countField:
            item.followups.find((field) => field.kind === "counter")?.id ??
            "value",
        }
      : {}),
  };
}
function ExtraQuestionEditor({
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
    <div className="editor-extra-form">
      <div className="editor-fields">
        <Field label="Extra question">
          <input
            value={followup.label}
            onChange={(event) =>
              onChange({ ...followup, label: event.target.value })
            }
          />
        </Field>
        <Field label="Answer format">
          <select
            value={followup.kind}
            onChange={(event) => {
              const kind = event.target.value as FollowupDefinition["kind"];
              onChange({
                ...followup,
                kind,
                ...(kind === "choice" && !followup.options?.length
                  ? { options: [{ id: createId(), label: "Choice 1" }] }
                  : {}),
                ...(kind === "occurrences" && !followup.countField
                  ? {
                      countField:
                        item.followups.find((field) => field.kind === "counter")
                          ?.id ?? "value",
                    }
                  : {}),
              });
            }}
          >
            {(["note", "counter", "choice", "occurrences"] as const).map(
              (kind) => (
                <option key={kind} value={kind}>
                  {extraLabel(kind)}
                </option>
              ),
            )}
          </select>
        </Field>
        {(followup.kind === "note" || followup.kind === "occurrences") && (
          <Field label="Placeholder (optional)" wide>
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
            <Field label="Smallest allowed count">
              <input
                type="number"
                value={followup.min ?? 1}
                onChange={(event) =>
                  onChange({
                    ...followup,
                    min:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Largest allowed count (optional)">
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
            <Field label="Starting count">
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
          <Field label="Count to use">
            <select
              value={followup.countField ?? "value"}
              onChange={(event) =>
                onChange({ ...followup, countField: event.target.value })
              }
            >
              {item.kind === "number" && (
                <option value="value">{item.label || "This question"}</option>
              )}
              {item.followups
                .filter((field) => field.kind === "counter")
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label || "Counter"}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      {followup.kind === "choice" && (
        <>
          <ChoicesEditor
            label="Extra choices"
            options={followup.options ?? []}
            onChange={(options) => onChange({ ...followup, options })}
          />
          <Toggle
            label="Use the selected choice as the item’s label"
            value={!!followup.displayChoiceLabel}
            onChange={(displayChoiceLabel) =>
              onChange({ ...followup, displayChoiceLabel })
            }
          />
          <Toggle
            label="Ask for a fresh choice when the main answer changes"
            value={!!followup.resetOnAnswer}
            onChange={(resetOnAnswer) =>
              onChange({ ...followup, resetOnAnswer })
            }
          />
        </>
      )}
      {followup.kind !== "counter" && (
        <Toggle
          label="Require an answer to earn the check"
          value={!!followup.required}
          onChange={(required) => onChange({ ...followup, required })}
        />
      )}
      {(followup.kind === "note" || followup.kind === "occurrences") && (
        <Toggle
          label="Show the note input initially"
          value={followup.initiallyExpanded ?? true}
          onChange={(initiallyExpanded) =>
            onChange({ ...followup, initiallyExpanded })
          }
        />
      )}
      <RuleEditor
        item={item}
        condition
        rule={followup.condition ?? { op: "always" }}
        onChange={(condition) => onChange({ ...followup, condition })}
      />
      <button
        type="button"
        className="editor-small-button editor-danger"
        onClick={onRemove}
      >
        <Trash2 size={14} />
        Remove extra question
      </button>
    </div>
  );
}

export interface ChecklistItemEditorProps {
  item: ChecklistItem;
  original?: ChecklistItem;
  blocks: ChecklistBlockDefinition[];
  lists: TodoListDefinition[];
  onChange: (value: ChecklistItem) => void;
  fixedConnection?: boolean;
}
export function ChecklistItemEditor({
  item,
  blocks,
  lists,
  onChange,
  fixedConnection = false,
}: ChecklistItemEditorProps) {
  const [advanced, setAdvanced] = useState(false);
  const [selectedExtra, setSelectedExtra] = useState<string>();
  function updateExtra(next: FollowupDefinition) {
    onChange({
      ...item,
      followups: item.followups.map((field) =>
        field.id === next.id ? next : field,
      ),
    });
  }
  return (
    <div className="editor-form">
      <div className="editor-fields">
        <Field label="Question" wide>
          <input
            autoComplete="off"
            value={item.label}
            placeholder="What would you like to track?"
            onChange={(event) =>
              onChange({ ...item, label: event.target.value })
            }
          />
        </Field>
        {!fixedConnection && (
          <Field label="Answer type">
            <select
              value={item.kind === "checkbox" ? "boolean" : item.kind}
              onChange={(event) => {
                const kind = event.target.value as ItemKind;
                onChange({
                  ...item,
                  kind,
                  completion: defaultEditorRule(kind),
                  ...(kind === "choice" && !item.options?.length
                    ? { options: [{ id: createId(), label: "Choice 1" }] }
                    : {}),
                  ...(kind !== "tasks" ? { listId: undefined } : {}),
                });
              }}
            >
              {!originalMainInput(item.kind) && (
                <option value={item.kind} disabled>
                  {itemKindLabel(item.kind)} (previous type)
                </option>
              )}
              {ITEM_TYPES.map(({ kind, label }) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!originalMainInput(item.kind) && (
          <p className="editor-notice editor-field-wide">
            Choose a supported main answer type. Notes, counters and choices
            belong in Extra questions; previous answers remain in history.
          </p>
        )}
        {item.kind === "choice" && (
          <div className="editor-field-wide">
            <h3>Choices</h3>
            <ChoicesEditor
              options={item.options ?? []}
              onChange={(options) => onChange({ ...item, options })}
            />
          </div>
        )}
        {!fixedConnection && (
          <SimpleCompletion
            item={item}
            onChange={(completion) => onChange({ ...item, completion })}
            onCustom={() => setAdvanced(true)}
          />
        )}
        {item.kind === "tasks" && (
          <>
            {!fixedConnection && (
              <Field label="Connected To-do list">
                <select
                  value={item.listId ?? ""}
                  onChange={(event) =>
                    onChange({ ...item, listId: event.target.value })
                  }
                >
                  <option value="">Choose a list</option>
                  {lists
                    .filter((list) => !list.deleted || list.id === item.listId)
                    .map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.title}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {fixedConnection && (
              <Field label="Block">
                <select
                  value={item.blockId}
                  onChange={(event) =>
                    onChange({
                      ...item,
                      blockId: event.target.value,
                      order: 1_000_000,
                    })
                  }
                >
                  {blocks
                    .filter((block) => !block.deleted)
                    .map((block) => (
                      <option key={block.id} value={block.id}>
                        {block.title}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Question visibility">
              <select
                value={item.visibility ?? "relevant"}
                onChange={(event) =>
                  onChange({
                    ...item,
                    visibility: event.target.value as "relevant" | "always",
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
      <ItemBehaviorSummary
        key={item.id}
        item={item}
        block={blocks.find((block) => block.id === item.blockId)}
        lists={lists}
      />
      <details
        className="editor-advanced"
        open={advanced}
        onToggle={(event) => setAdvanced(event.currentTarget.open)}
      >
        <summary>Advanced</summary>
        <section className="editor-form-section">
          <h3>Schedule</h3>
          <ScheduleEditor
            schedule={item.schedule}
            onChange={(schedule) => onChange({ ...item, schedule })}
          />
        </section>
        <section className="editor-form-section">
          <h3>Help text</h3>
          <Field label="Subtext (optional)" wide>
            <textarea
              rows={2}
              value={item.helper ?? ""}
              onChange={(event) =>
                onChange({ ...item, helper: event.target.value })
              }
            />
          </Field>
        </section>
        {(item.kind === "number" || item.kind === "duration") && (
          <section className="editor-form-section">
            <h3>Allowed answers</h3>
            <p className="editor-help">
              Limits what can be entered. Your completion goal is set above.
            </p>
            <div className="editor-fields">
              <Field
                label={
                  item.kind === "duration"
                    ? "Smallest allowed minutes"
                    : "Smallest allowed number"
                }
              >
                <input
                  type="number"
                  step="any"
                  value={item.min ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...item,
                      min:
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field
                label={
                  item.kind === "duration"
                    ? "Largest allowed minutes (optional)"
                    : "Largest allowed number (optional)"
                }
              >
                <input
                  type="number"
                  step="any"
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
                <Field label="Counter step">
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={item.step ?? 1}
                    onChange={(event) =>
                      onChange({ ...item, step: Number(event.target.value) })
                    }
                  />
                </Field>
              )}
            </div>
          </section>
        )}
        <section className="editor-form-section">
          <h3>
            Extra questions{" "}
            <span className="editor-count">{item.followups.length}</span>
          </h3>
          {item.followups.length === 0 && (
            <p className="editor-help">
              Ask for a note, count, or choice after the main answer.
            </p>
          )}
          {item.followups.map((followup) => (
            <div className="editor-extra-question" key={followup.id}>
              <button
                type="button"
                className="editor-extra-row"
                aria-expanded={selectedExtra === followup.id}
                onClick={() =>
                  setSelectedExtra(
                    selectedExtra === followup.id ? undefined : followup.id,
                  )
                }
              >
                <span>
                  <strong>{followup.label || "Untitled extra question"}</strong>
                  <span className="editor-summary">
                    {extraLabel(followup.kind)} ·{" "}
                    {followup.condition?.op === "always" || !followup.condition
                      ? "Always shown"
                      : `Ask when ${conditionSummary(followup.condition, item)}`}
                  </span>
                </span>
                {selectedExtra === followup.id ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </button>
              {selectedExtra === followup.id && (
                <ExtraQuestionEditor
                  followup={followup}
                  item={item}
                  onChange={updateExtra}
                  onRemove={() => {
                    onChange({
                      ...item,
                      followups: item.followups.filter(
                        (field) => field.id !== followup.id,
                      ),
                    });
                    setSelectedExtra(undefined);
                  }}
                />
              )}
            </div>
          ))}
          <div className="editor-actions">
            {(["note", "counter", "choice", "occurrences"] as const).map(
              (kind) => (
                <button
                  type="button"
                  className="editor-small-button"
                  key={kind}
                  disabled={
                    kind === "occurrences" &&
                    item.kind !== "number" &&
                    !item.followups.some((field) => field.kind === "counter")
                  }
                  onClick={() => {
                    const field = newExtra(item, kind);
                    onChange({
                      ...item,
                      followups: [...item.followups, field],
                    });
                    setSelectedExtra(field.id);
                  }}
                >
                  Add {kind === "occurrences" ? "notes for each count" : kind}
                </button>
              ),
            )}
          </div>
        </section>
        <section className="editor-form-section">
          <h3>Custom completion conditions</h3>
          <RuleEditor
            item={item}
            rule={item.completion}
            onChange={(completion) => onChange({ ...item, completion })}
          />
        </section>
      </details>
    </div>
  );
}
export function AnswerTypePicker({
  onChoose,
  onCancel,
}: {
  onChoose: (kind: ItemKind) => void;
  onCancel: () => void;
}) {
  return (
    <section className="editor-type-picker" aria-label="Choose an answer type">
      <h2>What kind of answer?</h2>
      <div className="editor-type-grid">
        {ITEM_TYPES.map(({ kind, description }) => (
          <button
            type="button"
            className="editor-type-option"
            key={kind}
            onClick={() => onChoose(kind)}
          >
            <strong>{itemKindLabel(kind)}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <button type="button" className="editor-small-button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
