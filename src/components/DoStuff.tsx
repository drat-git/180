import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  BriefcaseBusiness,
  GraduationCap,
  House,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import type { Task, TaskTopic } from "../lib/model";
import { repository } from "../lib/repository";
import { childrenOf, sortTasks, topicLabels } from "../lib/tasks";
import { useTasks } from "../lib/useTasks";
import { ChecklistBlock, Modal } from "./Controls";
import { AntiRotting } from "./AntiRotting";
import { DisplayPreferencesProvider } from "../lib/displayPreferences";

function AddTask({
  topic,
  parentId,
  onAdd,
}: {
  topic: TaskTopic;
  parentId?: string;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="task-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || saving) return;
        setSaving(true);
        void onAdd(title)
          .then((saved) => {
            if (saved) setTitle("");
          })
          .finally(() => setSaving(false));
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
  );
}

function TaskRow({
  task,
  children,
  busy,
  onComplete,
  onMenu,
  onSubtask,
}: {
  task: Task;
  children: Task[];
  busy: boolean;
  onComplete: () => Promise<boolean>;
  onMenu: () => void;
  onSubtask: () => void;
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
  return (
    <div
      className={`task-row ${completed ? "is-complete" : ""}`}
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
        <span className="task-title">{task.title}</span>
        {parent && (
          <span className="small">
            {done} / {children.length} subtasks complete
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
          <Plus size={13} />
          <span>Subtask</span>
        </button>
      )}
      <button
        className="icon-button task-menu-button"
        aria-label={`Actions for ${task.title}`}
        disabled={busy}
        onClick={onMenu}
      >
        <MoreHorizontal size={17} />
      </button>
    </div>
  );
}

export function DoStuff({
  userId,
  today,
  onSaving,
  onError,
  blocked,
}: {
  userId: string;
  today: string;
  onSaving: (delta: number) => void;
  onError: (message: string) => void;
  blocked: boolean;
}) {
  const { tasks, roots } = useTasks(userId);
  const [addingTo, setAddingTo] = useState<string | null>(null);
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
        <h1>
          Do Stuff<span className="day-title-dot">.</span>
        </h1>
        <p>A few things worth getting to.</p>
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
                    <li key={task.id}>
                      <TaskRow
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
                            topic={topic}
                            parentId={task.id}
                            onAdd={(value) =>
                              mutate(() =>
                                repository.createTask(
                                  userId,
                                  topic,
                                  value,
                                  task.id,
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
              topic={topic}
              onAdd={(value) =>
                mutate(() => repository.createTask(userId, topic, value))
              }
            />
          </ChecklistBlock>
        ))}
      </div>
      <p className="small task-help">
        Hold a task for options. Completed tasks stay for 12 hours; subtasks
        stay with their parent.
      </p>
      <AntiRotting
        userId={userId}
        today={today}
        onSaving={onSaving}
        onError={onError}
        blocked={blocked}
      />
      {menu && (
        <Modal title="Task options" onClose={() => setMenu(null)}>
          <p>{menu.title}</p>
          <div className="dialog-actions">
            <button
              onClick={() => {
                setEdit(menu);
                setTitle(menu.title);
                setMenu(null);
              }}
            >
              Edit
            </button>
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
              <button type="button" onClick={() => setEdit(null)}>
                Cancel
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
