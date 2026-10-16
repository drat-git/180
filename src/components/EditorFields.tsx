import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { ChoiceOption, Schedule } from "../lib/customizationTypes";
import { createId } from "../lib/model";

export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`editor-field${wide ? " editor-field-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="editor-toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
const ICONS = [
  "circle",
  "sun",
  "book",
  "briefcase",
  "utensils",
  "dumbbell",
  "heart",
  "home",
  "leaf",
  "star",
  "compass",
  "check",
];
export function IconSelect({
  value,
  onChange,
  label = "Icon",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!ICONS.includes(value) && (
          <option value={value}>{value.replaceAll("-", " ")}</option>
        )}
        {ICONS.map((icon) => (
          <option key={icon} value={icon}>
            {icon[0].toUpperCase() + icon.slice(1)}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule?: Schedule;
  onChange: (value: Schedule) => void;
}) {
  const current = schedule ?? {},
    weekdays = current.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="editor-fields">
      <fieldset className="editor-weekdays editor-field-wide">
        <legend>Appears on</legend>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
          <label key={day} className="editor-toggle">
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
export function ChoicesEditor({
  options,
  onChange,
  label = "Choices",
}: {
  options: ChoiceOption[];
  onChange: (values: ChoiceOption[]) => void;
  label?: string;
}) {
  return (
    <div className="editor-choices" role="group" aria-label={label}>
      {options.map((option, index) => (
        <div className="editor-extra-row" key={option.id}>
          <input
            aria-label={`${label} ${index + 1}`}
            value={option.label}
            onChange={(event) =>
              onChange(
                options.map((entry) =>
                  entry.id === option.id
                    ? { ...entry, label: event.target.value }
                    : entry,
                ),
              )
            }
          />
          <button
            className="editor-icon-button"
            type="button"
            aria-label={`Remove ${option.label || "choice"}`}
            onClick={() =>
              onChange(options.filter((entry) => entry.id !== option.id))
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="editor-small-button"
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
