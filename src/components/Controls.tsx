import { AutoTextarea } from "./AutoTextarea";
import { useEffect, useRef, useId, type ReactNode } from "react";
import {
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  Check,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { Answer } from "../lib/model";
import type { ChecklistCount } from "../lib/checklist";
import { useMinimized } from "../lib/displayPreferences";
export function ChecklistBlock({
  title,
  icon,
  preferenceKey,
  progress,
  children,
}: {
  title: string;
  icon?: ReactNode;
  preferenceKey?: string;
  progress?: ChecklistCount;
  children: ReactNode;
}) {
  const [minimized, setMinimized] = useMinimized(
    `block:${preferenceKey ?? title}`,
  );
  const contentId = useId();
  return (
    <section
      className="checklist-block"
      aria-label={title}
      data-block={title}
      data-minimized={minimized}
    >
      <div className="block-heading">
        <div className="block-title">
          {icon && (
            <span className="block-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="block-title-text">
            <h3>{title}</h3>
            {progress && (
              <span
                className="block-progress"
                aria-label={`${title} checklist progress`}
              >
                {progress.completed}/{progress.total} complete
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="text-button"
          aria-expanded={!minimized}
          aria-controls={contentId}
          aria-label={minimized ? `Maximize ${title}` : `Minimize ${title}`}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? "Maximize" : "Minimize"}
          {minimized ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>
      <div id={contentId} hidden={minimized}>
        {children}
      </div>
    </section>
  );
}
export function BinaryAnswer({
  label,
  value,
  onChange,
  completed,
}: {
  label: string;
  value: Answer;
  onChange: (v: boolean) => void;
  completed?: boolean;
}) {
  return (
    <div className="answers" role="group" aria-label={label}>
      {[true, false].map((answer) => (
        <button
          key={String(answer)}
          type="button"
          data-answer={answer ? "yes" : "no"}
          data-complete={completed ?? answer}
          aria-label={answer ? "Yes" : "No"}
          title={answer ? "Yes" : "No"}
          aria-pressed={value === answer}
          className={value === answer ? "selected" : ""}
          onClick={() => onChange(answer)}
        >
          {answer ? (
            <Check size={16} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
function CollapsibleSection({
  storageKey,
  value,
  addLabel,
  viewLabel,
  initiallyExpanded = false,
  children,
}: {
  storageKey: string;
  value: string;
  addLabel: string;
  viewLabel: string;
  initiallyExpanded?: boolean;
  children: ReactNode;
}) {
  const [minimized, setMinimized] = useMinimized(
    `text:${storageKey}`,
    !(initiallyExpanded || !!value.trim()),
  );
  return (
    <div className="reason">
      {!minimized ? (
        <>
          {children}
          <button
            className="text-button minimize"
            type="button"
            onClick={() => {
              setMinimized(true);
            }}
          >
            Minimize
          </button>
        </>
      ) : (
        <button
          className="text-button reason-link"
          type="button"
          onClick={() => {
            setMinimized(false);
          }}
        >
          <ArrowDownRight size={14} />
          {value.trim() ? viewLabel : addLabel}
        </button>
      )}
    </div>
  );
}
export function CollapsibleText({
  label,
  ariaLabel,
  placeholder,
  value,
  onChange,
  locked,
  onAttempt,
  ...disclosure
}: {
  label: string;
  ariaLabel: string;
  addLabel: string;
  viewLabel: string;
  placeholder: string;
  initiallyExpanded?: boolean;
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
  onAttempt: () => void;
}) {
  return (
    <CollapsibleSection {...disclosure} storageKey={ariaLabel} value={value}>
      <label>
        <span>{label}</span>
        <AutoTextarea
          aria-label={ariaLabel}
          rows={1}
          placeholder={placeholder}
          value={value}
          readOnly={locked}
          onFocus={() => {
            if (locked) onAttempt();
          }}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </CollapsibleSection>
  );
}
export function CannabisDescriptions({
  count,
  values,
  onChange,
  locked,
  onAttempt,
}: {
  count: number;
  values: string[];
  onChange: (index: number, value: string) => void;
  locked: boolean;
  onAttempt: () => void;
}) {
  return (
    <CollapsibleSection
      storageKey="cannabis-use-descriptions"
      value={values.slice(0, count).join("\n")}
      addLabel={count === 1 ? "Describe use 1" : "Describe each use"}
      viewLabel="View use descriptions"
      initiallyExpanded
    >
      <div className="use-descriptions">
        {Array.from({ length: count }, (_, index) => (
          <label key={index}>
            <span>Use {index + 1}</span>
            <AutoTextarea
              aria-label={`Cannabis use ${index + 1} description`}
              rows={1}
              placeholder="Any details you’d like to record."
              value={values[index] ?? ""}
              readOnly={locked}
              onFocus={() => {
                if (locked) onAttempt();
              }}
              onChange={(e) => onChange(index, e.target.value)}
            />
          </label>
        ))}
      </div>
    </CollapsibleSection>
  );
}
export function Reason(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
  onAttempt: () => void;
}) {
  return (
    <CollapsibleText
      {...props}
      label="Why?"
      ariaLabel={`${props.label} reason`}
      addLabel="Why? Add reason"
      viewLabel="View reason"
      placeholder="A little context, if you want."
      initiallyExpanded
    />
  );
}
export function Counter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="conditional counter-row">
      <span>{label}</span>
      <div className="counter">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={15} />
        </button>
        <output aria-label={label}>{value}</output>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= 2147483647}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-content">
        <button
          type="button"
          className="icon-button close-dialog"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
