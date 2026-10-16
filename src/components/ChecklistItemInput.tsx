import { useId, type ReactNode } from "react";
import { ArrowDownRight, Minus, Plus } from "lucide-react";
import type {
  ChecklistItem,
  ItemAnswer,
  FollowupValue,
} from "../lib/customizationTypes";
import { changeItemValue, evaluateItem, itemLabel } from "../lib/customization";
import { BinaryAnswer, CollapsibleText } from "./Controls";
import { AutoTextarea } from "./AutoTextarea";
import { useMinimized } from "../lib/displayPreferences";
import "./Customization.css";

export interface ChecklistItemInputProps {
  item: ChecklistItem;
  answer: ItemAnswer;
  onChange: (answer: ItemAnswer) => void;
  locked?: boolean;
  onAttempt?: (action?: () => void) => void;
  preferencePrefix?: string;
  /** The task picker is supplied by the daily view, keeping this input generic. */
  taskContent?: ReactNode;
  inputId?: string;
  preview?: boolean;
}

function NumberInput({
  label,
  value,
  min = 0,
  max = 2147483647,
  step = 1,
  onChange,
  locked,
  onAttempt,
  editable = true,
}: {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
  locked: boolean;
  onAttempt: () => void;
  editable?: boolean;
}) {
  return (
    <div className="customization-number">
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value !== null && value <= min}
        onClick={() => onChange(Math.max(min, (value ?? min + step) - step))}
      >
        <Minus size={14} />
      </button>
      {editable ? (
        <input
          type="number"
          aria-label={label}
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          inputMode="decimal"
          readOnly={locked}
          onFocus={() => {
            if (locked) onAttempt();
          }}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? null
                : Math.max(min, Math.min(max, Number(event.target.value))),
            )
          }
        />
      ) : (
        <output aria-label={label}>{value ?? min}</output>
      )}
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value !== null && value >= max}
        onClick={() => onChange(Math.min(max, (value ?? min - step) + step))}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function OccurrenceNotes({
  count,
  values,
  label,
  ariaLabel,
  preferenceKey,
  initiallyExpanded,
  placeholder,
  addLabel,
  viewLabel,
  locked,
  onAttempt,
  onChange,
}: {
  count: number;
  values: string[];
  label: string;
  ariaLabel: string;
  preferenceKey: string;
  initiallyExpanded: boolean;
  placeholder?: string;
  addLabel?: string;
  viewLabel?: string;
  locked: boolean;
  onAttempt: () => void;
  onChange: (value: string[]) => void;
}) {
  const [minimized, setMinimized] = useMinimized(
    `text:${preferenceKey}`,
    !(
      initiallyExpanded || values.slice(0, count).some((value) => value.trim())
    ),
  );
  const hasNotes = values.slice(0, count).some((value) => value.trim());
  return (
    <div className="reason">
      {minimized ? (
        <button
          className="text-button reason-link"
          type="button"
          onClick={() => setMinimized(false)}
        >
          <ArrowDownRight size={14} />
          {hasNotes
            ? (viewLabel ?? `View ${label.toLowerCase()} descriptions`)
            : (addLabel ??
              (count === 1
                ? `Describe ${label.toLowerCase()} 1`
                : `Describe each ${label.toLowerCase()}`))}
        </button>
      ) : (
        <>
          <div className="use-descriptions">
            {Array.from({ length: count }, (_, index) => (
              <label key={index}>
                <span>
                  {label} {index + 1}
                </span>
                <AutoTextarea
                  aria-label={ariaLabel.replace("{n}", String(index + 1))}
                  rows={1}
                  placeholder={
                    placeholder ?? "Any details you’d like to record."
                  }
                  value={values[index] ?? ""}
                  readOnly={locked}
                  onFocus={() => {
                    if (locked) onAttempt();
                  }}
                  onChange={(event) => {
                    const next = [...values];
                    while (next.length <= index) next.push("");
                    next[index] = event.target.value;
                    onChange(next);
                  }}
                />
              </label>
            ))}
          </div>
          <button
            className="text-button minimize"
            type="button"
            onClick={() => setMinimized(true)}
          >
            Minimize
          </button>
        </>
      )}
    </div>
  );
}

export function ChecklistItemInput({
  item,
  answer,
  onChange,
  locked = false,
  onAttempt = () => {},
  preferencePrefix = "custom",
  taskContent,
  inputId: suppliedInputId,
  preview = false,
}: ChecklistItemInputProps) {
  const generatedId = useId();
  const inputId =
    suppliedInputId ?? (!preview ? item.inputId : undefined) ?? generatedId;
  const evaluation = evaluateItem(item, answer);
  const complete = evaluation.complete;
  const label = itemLabel(item, answer);
  const commit = (next: ItemAnswer) => {
    if (locked) onAttempt(() => onChange(next));
    else onChange(next);
  };
  function value(next: ItemAnswer["value"]) {
    if (item.kind === "duration" && typeof next === "number") {
      next = Math.max(
        item.min ?? 0,
        Math.min(item.max ?? Number.MAX_SAFE_INTEGER, Math.round(next)),
      );
    }
    commit(changeItemValue(item, answer, next));
  }
  function field(id: string, next: FollowupValue) {
    commit({ ...answer, fields: { ...answer.fields, [id]: next } });
  }
  // Retain the original boolean values/generations in earlier starter definitions.
  // The retired checkbox type uses the same Yes/No control as existing checks.
  const binary =
    item.kind === "boolean" ||
    item.kind === "checkbox" ||
    item.kind === "tasks";
  const duration = typeof answer.value === "number" ? answer.value : null;
  return (
    <div
      className={`field${item.kind === "tasks" ? " task-activity" : ""}`}
      data-item-id={item.id}
      data-complete={answer.value !== null ? complete : undefined}
    >
      <div className="field-line">
        <label className="field-label" htmlFor={binary ? undefined : inputId}>
          {label}
          {item.helper && <span className="food-helper">{item.helper}</span>}
        </label>
        {binary && (
          <BinaryAnswer
            label={label}
            value={typeof answer.value === "boolean" ? answer.value : null}
            completed={complete}
            onChange={(next) => value(answer.value === next ? null : next)}
          />
        )}
        {item.kind === "number" && (
          <NumberInput
            label={label}
            value={typeof answer.value === "number" ? answer.value : null}
            min={item.min}
            max={item.max}
            step={item.step}
            onChange={value}
            locked={locked}
            onAttempt={onAttempt}
          />
        )}
        {item.kind === "time" && (
          <input
            id={inputId}
            aria-label={label}
            type="time"
            value={typeof answer.value === "string" ? answer.value : ""}
            data-complete={answer.value ? complete : undefined}
            readOnly={locked}
            onFocus={() => {
              if (locked) onAttempt();
            }}
            onChange={(event) => value(event.target.value || null)}
          />
        )}
        {item.kind === "duration" && (
          <div className="duration">
            <input
              id={`${inputId}-hours`}
              type="number"
              aria-label={`${label} hours`}
              min={0}
              max={item.max === undefined ? 8760 : Math.ceil(item.max / 60)}
              inputMode="numeric"
              placeholder="—"
              value={duration === null ? "" : Math.floor(duration / 60)}
              readOnly={locked}
              data-complete={duration !== null ? complete : undefined}
              onFocus={() => {
                if (locked) onAttempt();
              }}
              onChange={(event) =>
                value(
                  event.target.value === ""
                    ? duration && duration % 60
                      ? duration % 60
                      : null
                    : Math.max(0, Math.trunc(Number(event.target.value))) * 60 +
                        ((duration ?? 0) % 60),
                )
              }
            />
            <span>hrs</span>
            <input
              id={`${inputId}-minutes`}
              type="number"
              aria-label={`${label} minutes`}
              min={0}
              max={59}
              inputMode="numeric"
              placeholder="—"
              value={duration === null ? "" : duration % 60}
              readOnly={locked}
              data-complete={duration !== null ? complete : undefined}
              onFocus={() => {
                if (locked) onAttempt();
              }}
              onChange={(event) =>
                value(
                  event.target.value === ""
                    ? duration && Math.floor(duration / 60)
                      ? Math.floor(duration / 60) * 60
                      : null
                    : Math.floor((duration ?? 0) / 60) * 60 +
                        Math.max(
                          0,
                          Math.min(59, Math.trunc(Number(event.target.value))),
                        ),
                )
              }
            />
            <span>min</span>
            {duration !== null && (
              <button
                className="text-button clear-time"
                type="button"
                aria-label={`Clear ${item.label.toLowerCase()}`}
                onClick={() => value(null)}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      {item.kind === "text" && (
        <AutoTextarea
          id={inputId}
          aria-label={label}
          rows={1}
          className="customization-value-input"
          value={typeof answer.value === "string" ? answer.value : ""}
          readOnly={locked}
          onFocus={() => {
            if (locked) onAttempt();
          }}
          onChange={(event) => value(event.target.value)}
        />
      )}
      {item.kind === "choice" && (
        <fieldset className="breakfast-choice">
          <legend>{label}</legend>
          {item.options?.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name={inputId}
                value={option.id}
                checked={answer.value === option.id}
                onClick={() => {
                  if (answer.value === option.id) value(null);
                }}
                onChange={() => value(option.id)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      )}
      {item.kind === "tasks" && answer.value === true && taskContent}
      {evaluation.followups.map((followup) => {
        const current = answer.fields[followup.id];
        const preferenceKey =
          !preview && followup.preferenceKey
            ? followup.preferenceKey
            : `${preferencePrefix}:${item.id}:${followup.id}`;
        if (followup.kind === "note")
          return (
            <CollapsibleText
              key={followup.id}
              label={followup.label}
              ariaLabel={
                !preview && followup.ariaLabel
                  ? followup.ariaLabel
                  : `${item.label} ${followup.label}`
              }
              preferenceKey={preferenceKey}
              value={typeof current === "string" ? current : ""}
              addLabel={
                followup.addLabel ??
                `${followup.label}${followup.required ? " (required)" : ""}`
              }
              viewLabel={
                followup.viewLabel ?? `View ${followup.label.toLowerCase()}`
              }
              initiallyExpanded={followup.initiallyExpanded ?? true}
              placeholder={followup.placeholder ?? "Add a little context."}
              locked={locked}
              onAttempt={onAttempt}
              onChange={(next) => field(followup.id, next)}
            />
          );
        if (followup.kind === "counter")
          return (
            <div className="conditional counter-row" key={followup.id}>
              <span>{followup.label}</span>
              <NumberInput
                editable={false}
                label={followup.label}
                value={
                  typeof current === "number"
                    ? current
                    : typeof followup.defaultValue === "number"
                      ? followup.defaultValue
                      : null
                }
                min={followup.min ?? 1}
                max={followup.max}
                locked={locked}
                onAttempt={onAttempt}
                onChange={(next) => field(followup.id, next)}
              />
            </div>
          );
        if (followup.kind === "choice") {
          if (followup.displayChoiceLabel && current) return null;
          return (
            <fieldset className="breakfast-choice" key={followup.id}>
              <legend>
                {followup.label}
                {followup.required && !followup.label.includes("required")
                  ? " (required)"
                  : ""}
              </legend>
              {followup.options?.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={`${inputId}-${followup.id}`}
                    value={option.id}
                    checked={current === option.id}
                    onClick={() => {
                      if (current === option.id) field(followup.id, null);
                    }}
                    onChange={() => field(followup.id, option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          );
        }
        const rawCount =
          followup.countField === "value"
            ? answer.value
            : answer.fields[followup.countField ?? ""];
        const count =
          typeof rawCount === "number"
            ? Math.max(0, Math.min(1000, Math.floor(rawCount)))
            : 0;
        const descriptions = Array.isArray(current) ? current : [];
        return (
          <OccurrenceNotes
            key={followup.id}
            count={count}
            values={descriptions}
            label={followup.label}
            ariaLabel={
              !preview && followup.ariaLabel
                ? followup.ariaLabel
                : `${item.label} ${followup.label} {n}`
            }
            preferenceKey={preferenceKey}
            initiallyExpanded={followup.initiallyExpanded ?? true}
            placeholder={followup.placeholder}
            addLabel={followup.addLabel}
            viewLabel={followup.viewLabel}
            locked={locked}
            onAttempt={onAttempt}
            onChange={(next) => field(followup.id, next)}
          />
        );
      })}
    </div>
  );
}
