import type { Task, TaskCommand, TaskEvent, TaskOptions } from "./model";
import { deadlineInstant, validateDeadline } from "./taskDeadlines";

export const MAX_ESTIMATE_MINUTES = 525600;
export function validateTaskOptions(
  options: TaskOptions,
  parentId?: string | null,
) {
  if (
    "estimatedMinutes" in options &&
    options.estimatedMinutes !== null &&
    (!Number.isInteger(options.estimatedMinutes) ||
      options.estimatedMinutes! < 1 ||
      options.estimatedMinutes! > MAX_ESTIMATE_MINUTES)
  )
    throw new Error(
      "Enter an estimated time between 1 minute and 8,760 hours.",
    );
  if ("highPriority" in options && typeof options.highPriority !== "boolean")
    throw new Error("Choose a valid priority.");
  if (options.highPriority && parentId)
    throw new Error("High priority is available only for top-level tasks.");
  if ("deadline" in options) validateDeadline(options.deadline, parentId);
}
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60;
  return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""]
    .filter(Boolean)
    .join(" ");
}
export const TASK_RETENTION_MS = 12 * 60 * 60 * 1000;
export const topicLabels: Record<string, string> = {
  school: "School",
  career: "Career",
  life: "Life",
} as const;
export function childrenOf(tasks: Task[], parentId: string) {
  return tasks.filter((t) => t.parentId === parentId && !t.deletedAt);
}
export function sortTasks(
  tasks: Task[],
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const due = new Map(
    tasks.map((task) => [
      task.id,
      !task.parentId && !task.completedAt
        ? deadlineInstant(task.deadline, timezone)
        : Infinity,
    ]),
  );
  return [...tasks].sort(
    (a, b) =>
      Number(!!a.completedAt) - Number(!!b.completedAt) ||
      (!a.completedAt && !b.completedAt
        ? Number(!!b.highPriority && !b.parentId) -
          Number(!!a.highPriority && !a.parentId)
        : 0) ||
      (due.get(a.id)! === due.get(b.id)!
        ? 0
        : due.get(a.id)! - due.get(b.id)!) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function visibleRoots(tasks: Task[], now: number, timezone?: string) {
  return sortTasks(
    tasks.filter(
      (t) =>
        !t.parentId &&
        !t.deletedAt &&
        (!t.completedAt || now < Date.parse(t.completedAt) + TASK_RETENTION_MS),
    ),
    timezone,
  );
}

// Deterministic event IDs make replay safe without resetting completion times.
export function applyTaskCommand(
  source: Task[],
  userId: string,
  operationId: string,
  command: TaskCommand,
) {
  const tasks = source.map((t) => ({ ...t }));
  const events: TaskEvent[] = [];
  let task = tasks.find((t) => t.id === command.taskId);
  const touch = (t: Task) => {
    t.updatedAt = command.at;
  };
  const transition = (t: Task, complete: boolean) => {
    if (!!t.completedAt === complete) return;
    t.completedAt = complete ? command.at : null;
    touch(t);
    events.push({
      id: `${operationId}:${t.id}`,
      operationId,
      userId,
      taskId: t.id,
      parentId: t.parentId,
      topic: t.topic,
      title: t.title,
      type: complete ? "completed" : "reopened",
      at: command.at,
      logicalDate: command.logicalDate,
      timezone: command.timezone,
    });
  };
  if (command.action === "create") {
    if (task) return { tasks, events };
    const title = command.title?.trim();
    if (!title || title.length > 500 || !command.topic)
      throw new Error("Enter a task title of 1–500 characters.");
    if (command.parentId) {
      const parent = tasks.find((t) => t.id === command.parentId);
      if (parent?.deletedAt) return { tasks, events };
      if (!parent || parent.parentId || parent.topic !== command.topic)
        throw new Error("Choose a top-level parent in the same topic.");
    }
    validateTaskOptions(command, command.parentId);
    task = {
      estimatedMinutes: command.estimatedMinutes ?? null,
      highPriority: command.highPriority ?? false,
      deadline: command.deadline ?? null,
      id: command.taskId,
      userId,
      title,
      topic: command.topic,
      parentId: command.parentId ?? null,
      completedAt: null,
      deletedAt: null,
      revision: 0,
      createdAt: command.at,
      updatedAt: command.at,
    };
    tasks.push(task);
  } else {
    if (!task || task.deletedAt) return { tasks, events };
    if (command.action === "rename") {
      const title = command.title?.trim();
      if (!title || title.length > 500)
        throw new Error("Enter a task title of 1–500 characters.");
      task.title = title;
      touch(task);
    } else if (command.action === "complete") {
      if (!childrenOf(tasks, task.id).length)
        transition(task, !!command.completed);
    } else if (command.action === "options") {
      if (
        !("estimatedMinutes" in command) &&
        !("highPriority" in command) &&
        !("deadline" in command)
      )
        throw new Error("Choose a task option to update.");
      validateTaskOptions(command, task.parentId);
      if ("estimatedMinutes" in command)
        task.estimatedMinutes = command.estimatedMinutes;
      if ("highPriority" in command) task.highPriority = command.highPriority;
      if ("deadline" in command) task.deadline = command.deadline;
      touch(task);
    } else if (command.action === "delete") {
      task.deletedAt = command.at;
      touch(task);
      for (const child of childrenOf(tasks, task.id)) {
        child.deletedAt = command.at;
        touch(child);
      }
    } else throw new Error("Unknown task action.");
  }
  if (task.parentId) {
    const parent = tasks.find((t) => t.id === task!.parentId);
    if (parent && !parent.deletedAt) {
      const children = childrenOf(tasks, parent.id);
      transition(
        parent,
        children.length > 0 && children.every((t) => !!t.completedAt),
      );
    }
  }
  return { tasks, events };
}
