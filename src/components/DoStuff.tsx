import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  BriefcaseBusiness,
  GraduationCap,
  House,
  Plus,
  Clock3,
  Flag,
  CalendarClock,
} from "lucide-react";
import type { Task, TaskTopic, TaskOptions } from "../lib/model";
import { repository } from "../lib/repository";
import {
  childrenOf,
  sortTasks,
  topicLabels,
  formatDuration,
} from "../lib/tasks";
import { useTasks } from "../lib/useTasks";
import { TaskOptionsDialog } from "./TaskOptionsDialog";
import { ChecklistBlock, Modal } from "./Controls";
import { DisplayPreferencesProvider } from "../lib/displayPreferences";
import { deadlinePresentation } from "../lib/taskDeadlines";

function AddTask({
  topic,
  parentId,
  timezone,
  onAdd,
}: {
  topic: TaskTopic;
  parentId?: string;
  timezone: string;
  onAdd: (title: string, options: TaskOptions) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  return (
    <>
      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || saving) return;
          setOptionsOpen(true);
        }}
      >
        <input
          aria-label={parentId ? "New subtask" : `New ${topic} task`}
          placeholder={parentId ? "Add a subtask…" : "Add a task…"}
          maxLength={500}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
        />
        <button
          type="submit"
          className="task-add-button"
          disabled={saving || !title.trim()}
          aria-label={parentId ? "Add subtask" : `Add ${topic} task`}
        >
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>
      {optionsOpen && (
        <TaskOptionsDialog
          title={parentId ? "Add subtask options" : "Add task options"}
          taskTitle={title.trim()}
          parentId={parentId}
          timezone={timezone}
          busy={saving}
          onClose={() => setOptionsOpen(false)}
          onSave={(options) => {
            setSaving(true);
            void onAdd(title, options)
              .then((saved) => {
                if (saved) {
                  setTitle("");
                  setOptionsOpen(false);
                }
              })
              .finally(() => setSaving(false));
          }}
        />
      )}
    </>
  );
}

function TaskRow({
  task,
  children,
  busy,
  onComplete,
  onMenu,
  onSubtask,
  now,
  timezone,
}: {
  task: Task;
  children: Task[];
  busy: boolean;
  onComplete: () => Promise<boolean>;
  onMenu: () => void;
  onSubtask: () => void;
  now: number;
  timezone: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => cancel, []);
  const begin = (e: PointerEvent) => {
    held.current = false;
    if (e.button !== 0 || (e.target as Element).closest("button,input")) return;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      held.current = true;
      onMenu();
    }, 500);
  };
  const [optimisticComplete, setOptimisticComplete] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    if (
      optimisticComplete !== null &&
      !!task.completedAt === optimisticComplete
    )
      setOptimisticComplete(null);
  }, [task.completedAt, optimisticComplete]);
  const completed = optimisticComplete ?? !!task.completedAt;
  const parent = children.length > 0;
  const done = children.filter((t) => t.completedAt).length;
  const due =
    !task.parentId && task.deadline
      ? deadlinePresentation(task.deadline, now, timezone, completed)
      : null;
  return (
    <div
      className={`task-row ${parent ? "is-parent" : task.parentId ? "is-child" : "is-standalone"} ${completed ? "is-complete" : ""} ${task.highPriority && !task.parentId ? "is-high-priority" : ""}`}
      role="group"
      aria-label={`Task ${task.title}`}
      tabIndex={busy ? -1 : 0}
      title="Hold for options, or press Shift+F10 when focused."
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || busy) return;
        if (
          e.key === "ContextMenu" ||
          (e.shiftKey && e.key === "F10") ||
          e.key === "Enter"
        ) {
          e.preventDefault();
          onMenu();
        }
      }}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onPointerMove={(e) => {
        if (
          start.current &&
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
            8
        )
          cancel();
      }}
      onClickCapture={(e) => {
        if (held.current) {
          e.preventDefault();
          e.stopPropagation();
          held.current = false;
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
        onMenu();
      }}
    >
      <input
        type="checkbox"
        aria-label={`Complete ${task.title}`}
        checked={completed}
        disabled={busy || parent || optimisticComplete !== null}
        onChange={(e) => {
          setOptimisticComplete(e.target.checked);
          void onComplete().then((ok) => {
            if (!ok) setOptimisticComplete(null);
          });
        }}
        ref={(input) => {
          if (input)
            input.indeterminate = parent && done > 0 && done < children.length;
        }}
      />
      <div className="task-copy">
        <span className="task-title-line">
          {task.highPriority && !task.parentId && (
            <Flag
              size={14}
              className="task-priority"
              role="img"
              aria-label="High priority"
            />
          )}
          <span className="task-title">{task.title}</span>
        </span>
        {(task.estimatedMinutes != null || due) && (
          <span className="task-metadata">
            {task.estimatedMinutes != null && (
              <span className="task-estimate">
                <Clock3 size={12} aria-hidden="true" /> Est.{" "}
                {formatDuration(task.estimatedMinutes)}
              </span>
            )}
            {due && (
              <span className={`task-due ${due.overdue ? "is-overdue" : ""}`}>
                <CalendarClock size={12} aria-hidden="true" /> {due.label}
              </span>
            )}
          </span>
        )}
        {parent && (
          <span className="small task-parent-progress">
            {done} of {children.length} complete
          </span>
        )}
      </div>
      {!task.parentId && (
        <button
          className="text-button subtask-button"
          disabled={busy}
          aria-label={`Add subtask to ${task.title}`}
          onClick={onSubtask}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function DoStuff({
  userId,
  onSaving,
  onError,
  blocked,
}: {
  userId: string;
  onSaving: (delta: number) => void;
  onError: (message: string) => void;
  blocked: boolean;
}) {
  const { tasks, roots, now, timezone } = useTasks(userId);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Task | null>(null);
  const [due, setDue] = useState<Task | null>(null);
  const [menu, setMenu] = useState<Task | null>(null);
  const [edit, setEdit] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [remove, setRemove] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  async function mutate(action: () => Promise<unknown>) {
    if (busy || blocked) return false;
    setBusy(true);
    onSaving(1);
    try {
      await action();
      return true;
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Could not save the task locally.",
      );
      return false;
    } finally {
      setBusy(false);
      onSaving(-1);
    }
  }
  const icons = {
    school: <GraduationCap size={18} />,
    career: <BriefcaseBusiness size={18} />,
    life: <House size={18} />,
  };
  return (
    <DisplayPreferencesProvider userId={userId}>
      <section className="do-stuff-heading">
        <h1>To-do</h1>
        <p>
          “Every action you take is a vote for the type of person you wish to
          become.” - James Clear
        </p>
      </section>
      <div className="task-topics">
        {(["school", "career", "life"] as const).map((topic) => (
          <ChecklistBlock
            key={topic}
            title={topicLabels[topic]}
            preferenceKey={`tasks:${topic}`}
            icon={icons[topic]}
          >
            {roots.filter((t) => t.topic === topic).length === 0 && (
              <p className="task-empty small">No tasks here yet.</p>
            )}
            <ul className="task-list">
              {roots
                .filter((t) => t.topic === topic)
                .map((task) => {
                  const children = sortTasks(childrenOf(tasks, task.id));
                  return (
                    <li
                      key={task.id}
                      className={children.length ? "task-group" : undefined}
                    >
                      <TaskRow
                        now={now}
                        timezone={timezone}
                        task={task}
                        children={children}
                        busy={busy || blocked}
                        onComplete={() =>
                          mutate(() =>
                            repository.completeTask(
                              userId,
                              task.id,
                              !task.completedAt,
                            ),
                          )
                        }
                        onMenu={() => setMenu(task)}
                        onSubtask={() =>
                          setAddingTo(addingTo === task.id ? null : task.id)
                        }
                      />
                      {children.length > 0 && (
                        <ul className="task-children">
                          {children.map((child) => (
                            <li key={child.id}>
                              <TaskRow
                                now={now}
                                timezone={timezone}
                                task={child}
                                children={[]}
                                busy={busy || blocked}
                                onComplete={() =>
                                  mutate(() =>
                                    repository.completeTask(
                                      userId,
                                      child.id,
                                      !child.completedAt,
                                    ),
                                  )
                                }
                                onMenu={() => setMenu(child)}
                                onSubtask={() => {}}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                      {addingTo === task.id && (
                        <div className="subtask-form">
                          <AddTask
                            timezone={timezone}
                            topic={topic}
                            parentId={task.id}
                            onAdd={(value, options) =>
                              mutate(() =>
                                repository.createTask(
                                  userId,
                                  topic,
                                  value,
                                  task.id,
                                  options,
                                ),
                              )
                            }
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
            <AddTask
              timezone={timezone}
              topic={topic}
              onAdd={(value, options) =>
                mutate(() =>
                  repository.createTask(
                    userId,
                    topic,
                    value,
                    undefined,
                    options,
                  ),
                )
              }
            />
          </ChecklistBlock>
        ))}
      </div>
      <p className="small task-help">
        Hold a task for options. Completed tasks stay for 12 hours; subtasks
        stay with their parent.
      </p>
      {menu && (
        <Modal
          title="Task options"
          className="task-dialog"
          onClose={() => setMenu(null)}
        >
          <p>{menu.title}</p>
          <div className="dialog-actions task-menu-actions">
            <button
              disabled={busy || blocked}
              onClick={() => {
                setEdit(menu);
                setTitle(menu.title);
                setMenu(null);
              }}
            >
              Edit text
            </button>
            <button
              disabled={busy || blocked}
              onClick={() => {
                setEstimate(menu);
                setMenu(null);
              }}
            >
              {menu.estimatedMinutes != null
                ? "Edit estimated time"
                : "Add estimated time"}
            </button>
            {!menu.parentId && (
              <>
                <button
                  disabled={busy || blocked}
                  onClick={() => {
                    setDue(menu);
                    setMenu(null);
                  }}
                >
                  {menu.deadline ? "Edit due date" : "Add due date"}
                </button>
                <button
                  disabled={busy || blocked}
                  onClick={() => {
                    void mutate(() =>
                      repository.updateTaskOptions(userId, menu.id, {
                        highPriority: !menu.highPriority,
                      }),
                    ).then((ok) => {
                      if (ok) setMenu(null);
                    });
                  }}
                >
                  {menu.highPriority
                    ? "Remove high priority"
                    : "Mark high priority"}
                </button>
              </>
            )}
            <button
              className="danger"
              onClick={() => {
                setRemove(menu);
                setMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {estimate && (
        <TaskOptionsDialog
          title="Estimated time"
          taskTitle={estimate.title}
          parentId={estimate.parentId}
          initial={estimate}
          estimateOnly
          busy={busy || blocked}
          onClose={() => setEstimate(null)}
          onBack={() => {
            setMenu(
              tasks.find(
                (task) => task.id === estimate.id && !task.deletedAt,
              ) ?? null,
            );
            setEstimate(null);
          }}
          onRemove={
            estimate.estimatedMinutes != null
              ? () => {
                  void mutate(() =>
                    repository.updateTaskOptions(userId, estimate.id, {
                      estimatedMinutes: null,
                    }),
                  ).then((ok) => {
                    if (ok) setEstimate(null);
                  });
                }
              : undefined
          }
          onSave={(options) => {
            void mutate(() =>
              repository.updateTaskOptions(userId, estimate.id, options),
            ).then((ok) => {
              if (ok) setEstimate(null);
            });
          }}
        />
      )}
      {due && (
        <TaskOptionsDialog
          title="Due date"
          taskTitle={due.title}
          initial={due}
          deadlineOnly
          timezone={timezone}
          busy={busy || blocked}
          onClose={() => setDue(null)}
          onBack={() => {
            setMenu(
              tasks.find((task) => task.id === due.id && !task.deletedAt) ??
                null,
            );
            setDue(null);
          }}
          onRemove={
            due.deadline
              ? () => {
                  void mutate(() =>
                    repository.updateTaskOptions(userId, due.id, {
                      deadline: null,
                    }),
                  ).then((ok) => {
                    if (ok) setDue(null);
                  });
                }
              : undefined
          }
          onSave={(options) => {
            void mutate(() =>
              repository.updateTaskOptions(userId, due.id, options),
            ).then((ok) => {
              if (ok) setDue(null);
            });
          }}
        />
      )}
      {edit && (
        <Modal title="Edit task" onClose={() => setEdit(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(() =>
                repository.renameTask(userId, edit.id, title),
              ).then((ok) => {
                if (ok) setEdit(null);
              });
            }}
          >
            <label>
              Task title
              <input
                aria-label="Task title"
                maxLength={500}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy || blocked}
                onClick={() => {
                  setMenu(
                    tasks.find(
                      (task) => task.id === edit.id && !task.deletedAt,
                    ) ?? null,
                  );
                  setEdit(null);
                }}
              >
                Back
              </button>
              <button
                className="primary"
                disabled={busy || blocked || !title.trim()}
              >
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Delete task?" onClose={() => setRemove(null)}>
          <p>
            Delete “{remove.title}”
            {childrenOf(tasks, remove.id).length ? " and its subtasks" : ""}?
            Previous daily records and completion history will remain.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setRemove(null)}>Cancel</button>
            <button
              className="danger"
              disabled={busy || blocked}
              onClick={() =>
                void mutate(() =>
                  repository.deleteTask(userId, remove.id),
                ).then((ok) => {
                  if (ok) setRemove(null);
                })
              }
            >
              Delete task
            </button>
          </div>
        </Modal>
      )}
    </DisplayPreferencesProvider>
  );
}
