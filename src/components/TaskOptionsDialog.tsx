import { useState } from "react";
import type { TaskOptions } from "../lib/model";
import { MAX_ESTIMATE_MINUTES } from "../lib/tasks";
import { Modal } from "./Controls";

export function TaskOptionsDialog({
  title,
  taskTitle,
  parentId,
  initial = {},
  estimateOnly = false,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  taskTitle: string;
  parentId?: string | null;
  initial?: TaskOptions;
  estimateOnly?: boolean;
  busy: boolean;
  onSave: (options: TaskOptions) => void;
  onClose: () => void;
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
          setError("");
          onSave({
            estimatedMinutes: includeEstimate ? duration : null,
            ...(!estimateOnly && !parentId ? { highPriority: priority } : {}),
          });
        }}
      >
        <label className="task-setting-toggle">
          <input
            type="checkbox"
            checked={includeEstimate}
            disabled={busy}
            onChange={(event) => setIncludeEstimate(event.target.checked)}
          />
          Include an estimated time
        </label>
        {includeEstimate && (
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
        {!estimateOnly && !parentId && (
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
        {!estimateOnly && (
          <p className="small">
            {parentId
              ? "Estimated time is optional. You can change it later by holding the subtask."
              : "Both options are optional. You can change them later by holding the task."}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
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
