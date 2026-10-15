import { useState } from "react";
import type { TaskOptions } from "../lib/model";
import { MAX_ESTIMATE_MINUTES } from "../lib/tasks";
import { Modal } from "./Controls";
import { deadlineFromInput, deadlineInput } from "../lib/taskDeadlines";

export function TaskOptionsDialog({
  title,
  taskTitle,
  parentId,
  initial = {},
  estimateOnly = false,
  deadlineOnly = false,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  busy,
  onSave,
  onClose,
  onBack,
  onRemove,
}: {
  title: string;
  taskTitle: string;
  parentId?: string | null;
  initial?: TaskOptions;
  estimateOnly?: boolean;
  deadlineOnly?: boolean;
  timezone?: string;
  busy: boolean;
  onSave: (options: TaskOptions) => void;
  onClose: () => void;
  onBack?: () => void;
  onRemove?: () => void;
}) {
  const [includeEstimate, setIncludeEstimate] = useState(
    estimateOnly || initial.estimatedMinutes != null,
  );
  const [hours, setHours] = useState(
    String(Math.floor((initial.estimatedMinutes ?? 0) / 60)),
  );
  const [minutes, setMinutes] = useState(
    String((initial.estimatedMinutes ?? 0) % 60),
  );
  const [priority, setPriority] = useState(initial.highPriority ?? false);
  const originalDue = deadlineInput(initial.deadline, timezone);
  const [includeDue, setIncludeDue] = useState(
    deadlineOnly || !!initial.deadline,
  );
  const [dueDate, setDueDate] = useState(originalDue.date);
  const [includeTime, setIncludeTime] = useState(!!initial.deadline?.at);
  const [dueTime, setDueTime] = useState(originalDue.time);
  const [error, setError] = useState("");
  return (
    <Modal
      title={title}
      className="task-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="task-options-title">{taskTitle}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const h = Number(hours || 0),
            m = Number(minutes || 0),
            duration = h * 60 + m;
          if (
            !deadlineOnly &&
            includeEstimate &&
            (!Number.isInteger(h) ||
              !Number.isInteger(m) ||
              h < 0 ||
              m < 0 ||
              m > 59 ||
              duration < 1 ||
              duration > MAX_ESTIMATE_MINUTES)
          ) {
            setError(
              "Enter a positive duration using whole hours and minutes (0–59 minutes).",
            );
            return;
          }
          try {
            const options: TaskOptions = deadlineOnly
              ? {}
              : {
                  estimatedMinutes: includeEstimate ? duration : null,
                  ...(!estimateOnly && !parentId
                    ? { highPriority: priority }
                    : {}),
                };
            if (!estimateOnly && !parentId) {
              options.deadline = !includeDue
                ? null
                : initial.deadline &&
                    dueDate === originalDue.date &&
                    (includeTime ? dueTime : "") === originalDue.time
                  ? initial.deadline
                  : deadlineFromInput(
                      dueDate,
                      includeTime ? dueTime : null,
                      timezone,
                    );
            }
            setError("");
            onSave(options);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Choose a valid due date.",
            );
          }
        }}
      >
        {!deadlineOnly && (
          <label className="task-setting-toggle">
            <input
              type="checkbox"
              checked={includeEstimate}
              disabled={busy}
              onChange={(event) => setIncludeEstimate(event.target.checked)}
            />
            Include an estimated time
          </label>
        )}
        {!deadlineOnly && includeEstimate && (
          <div className="task-duration-fields">
            <label>
              Hours
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={8760}
                step={1}
                aria-label="Estimated hours"
                value={hours}
                disabled={busy}
                onChange={(event) => setHours(event.target.value)}
              />
            </label>
            <label>
              Minutes
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={1}
                aria-label="Estimated minutes"
                value={minutes}
                disabled={busy}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
          </div>
        )}
        {!estimateOnly && !deadlineOnly && !parentId && (
          <label className="task-setting-toggle">
            <input
              type="checkbox"
              checked={priority}
              disabled={busy}
              onChange={(event) => setPriority(event.target.checked)}
            />
            High priority
          </label>
        )}
        {!estimateOnly && !parentId && (
          <>
            {!deadlineOnly && (
              <label className="task-setting-toggle">
                <input
                  type="checkbox"
                  checked={includeDue}
                  disabled={busy}
                  onChange={(event) => setIncludeDue(event.target.checked)}
                />
                Include a due date
              </label>
            )}
            {includeDue && (
              <div className="task-deadline-fields">
                <label>
                  Due date
                  <input
                    type="date"
                    aria-label="Due date"
                    min="0001-01-01"
                    max="9999-12-31"
                    required
                    value={dueDate}
                    disabled={busy}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
                <label className="task-setting-toggle">
                  <input
                    type="checkbox"
                    checked={includeTime}
                    disabled={busy}
                    onChange={(event) => setIncludeTime(event.target.checked)}
                  />
                  Include a time
                </label>
                {includeTime && (
                  <label>
                    Due time <span className="small">({timezone})</span>
                    <input
                      type="time"
                      aria-label="Due time"
                      required
                      value={dueTime}
                      disabled={busy}
                      onChange={(event) => setDueTime(event.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {!estimateOnly && !deadlineOnly && (
          <p className="small">
            {parentId
              ? "Estimated time is optional. You can change it later by holding the subtask."
              : "These options are optional. You can change them later by holding the task."}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div
          className={`dialog-actions${onBack ? " task-editor-actions" : ""}`}
        >
          {onRemove && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={onRemove}
            >
              {deadlineOnly ? "Remove due date" : "Remove estimated time"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onBack ?? onClose}>
            {onBack ? "Back" : "Cancel"}
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : deadlineOnly
                ? "Save due date"
                : estimateOnly
                  ? "Save estimated time"
                  : parentId
                    ? "Add subtask"
                    : "Add task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
