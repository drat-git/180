import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { ActivityTopic, Answer, Task, TaskSelection } from "../lib/model";
import { childrenOf, sortTasks, topicLabels } from "../lib/tasks";
import { BinaryAnswer, Reason } from "./Controls";
import { useMinimized } from "../lib/displayPreferences";

export function TaskActivity({
  topic,
  roots,
  tasks,
  status,
  reason,
  selections,
  locked,
  onAttempt,
  onAnswer,
  onReason,
  onSelections,
}: {
  topic: ActivityTopic;
  roots: Task[];
  tasks: Task[];
  status: Answer;
  reason: string;
  selections: TaskSelection[];
  locked: boolean;
  onAttempt: () => void;
  onAnswer: (answer: boolean) => void;
  onReason: (value: string) => void;
  onSelections: (values: TaskSelection[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useMinimized(`activity:${topic}`);
  const available = roots.filter((t) => t.topic === topic);
  const label = `Worked on ${topic} tasks?`;
  if (
    !available.length &&
    status === null &&
    !reason.trim() &&
    !selections.length
  )
    return null;
  const change = (next: TaskSelection[]) => {
    if (locked) onAttempt();
    else onSelections(next);
  };
  function toggleTask(task: Task) {
    const existing = selections.find((s) => s.taskId === task.id);
    change(
      existing
        ? selections.filter((s) => s.taskId !== task.id)
        : [...selections, { taskId: task.id, title: task.title, children: [] }],
    );
  }
  function toggleChild(parent: TaskSelection, child: Task) {
    const selected = parent.children.some((c) => c.taskId === child.id);
    change(
      selections.map((s) =>
        s.taskId !== parent.taskId
          ? s
          : {
              ...s,
              children: selected
                ? s.children.filter((c) => c.taskId !== child.id)
                : [...s.children, { taskId: child.id, title: child.title }],
            },
      ),
    );
  }
  return (
    <div className="field task-activity">
      <div className="field-line">
        <span className="field-label">{label}</span>
        <BinaryAnswer label={label} value={status} onChange={onAnswer} />
      </div>
      {status === false && (
        <Reason
          label={label}
          value={reason}
          locked={locked}
          onAttempt={onAttempt}
          onChange={onReason}
        />
      )}
      {status === true && (
        <div className="reason">
          <button
            type="button"
            className="task-picker-toggle"
            aria-expanded={open}
            aria-controls={`task-picker-${topic}`}
            onClick={() => {
              if (locked) onAttempt();
              else setOpen(!open);
            }}
          >
            Choose {topic} tasks <ChevronDown size={15} />
          </button>
          {open && (
            <div
              id={`task-picker-${topic}`}
              className="task-picker"
              role="group"
              aria-label={`${topicLabels[topic]} tasks worked on`}
            >
              {!available.length && (
                <p className="small">
                  No current tasks to select. Your recorded selections remain
                  below.
                </p>
              )}
              {available.map((task) => {
                const selected = selections.find((s) => s.taskId === task.id);
                const children = sortTasks(childrenOf(tasks, task.id));
                return (
                  <div key={task.id}>
                    <label
                      className={`task-option ${task.completedAt ? "is-complete" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={() => toggleTask(task)}
                      />
                      <span>{task.title}</span>
                      {task.completedAt && (
                        <span className="small">Completed</span>
                      )}
                    </label>
                    {selected && children.length > 0 && (
                      <div className="task-child-options">
                        <span className="small">
                          Which subtasks? (Optional)
                        </span>
                        {children.map((child) => (
                          <label
                            key={child.id}
                            className={`task-option ${child.completedAt ? "is-complete" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.children.some(
                                (c) => c.taskId === child.id,
                              )}
                              onChange={() => toggleChild(selected, child)}
                            />
                            <span>{child.title}</span>
                            {child.completedAt && (
                              <span className="small">Completed</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {minimized ? (
            <button
              className="text-button reason-link"
              onClick={() => setMinimized(false)}
            >
              View tasks worked on
              {selections.length ? ` (${selections.length})` : ""}
            </button>
          ) : (
            <>
              <div
                className="worked-on-list"
                role="group"
                aria-label={`Recorded ${topic} tasks`}
              >
                {!selections.length && (
                  <p className="small">No tasks selected yet.</p>
                )}
                <ul>
                  {selections.map((selection) => (
                    <li key={selection.taskId}>
                      <div className="worked-on-line">
                        <span>{selection.title}</span>
                        <button
                          className="icon-button"
                          aria-label={`Remove recorded task ${selection.title}`}
                          onClick={() =>
                            change(
                              selections.filter(
                                (s) => s.taskId !== selection.taskId,
                              ),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {selection.children.length > 0 && (
                        <ul>
                          {selection.children.map((child) => (
                            <li key={child.taskId}>
                              <div className="worked-on-line">
                                <span>{child.title}</span>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove recorded subtask ${child.title}`}
                                  onClick={() =>
                                    change(
                                      selections.map((s) =>
                                        s.taskId !== selection.taskId
                                          ? s
                                          : {
                                              ...s,
                                              children: s.children.filter(
                                                (c) =>
                                                  c.taskId !== child.taskId,
                                              ),
                                            },
                                      ),
                                    )
                                  }
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                className="text-button minimize"
                onClick={() => setMinimized(true)}
              >
                Minimize
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
