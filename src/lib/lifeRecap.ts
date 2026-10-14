import { modeForUser, type AppMode } from "./appMode";
import type { Task, TaskEvent } from "./model";
import { latestTaskEvent, retainedTaskEvents } from "./taskActivityVisibility";

export interface CompletedLifeGroup {
  taskId: string;
  title: string;
  completed: boolean;
  children: { taskId: string; title: string }[];
}

// A past day's accomplishments come from that day's final transitions, not
// today's task state or the temporary 12-hour To-do display list.
export function completedLifeTasksForDay(
  userId: string,
  date: string,
  tasks: readonly Task[],
  events: readonly TaskEvent[],
  mode: AppMode = modeForUser(userId),
): CompletedLifeGroup[] {
  const ownedTasks = tasks.filter((task) => task.userId === userId);
  const byId = new Map(ownedTasks.map((task) => [task.id, task]));
  const history = new Map<string, TaskEvent[]>();
  for (const event of retainedTaskEvents(
    ownedTasks,
    events.filter((event) => event.userId === userId),
    mode,
  )) {
    if (event.topic !== "life") continue;
    const list = history.get(event.taskId) ?? [];
    list.push(event);
    history.set(event.taskId, list);
  }
  const completed = new Map<string, TaskEvent>();
  for (const [taskId, list] of history) {
    const event = latestTaskEvent(
      list.filter((event) => event.logicalDate === date),
      byId.get(taskId),
    );
    if (event?.type === "completed") completed.set(taskId, event);
  }
  const groups = new Map<string, CompletedLifeGroup>();
  for (const event of completed.values()) {
    const rootId = event.parentId ?? event.taskId;
    let group = groups.get(rootId);
    if (!group) {
      const rootCompletion = completed.get(rootId);
      const parentHistory = latestTaskEvent(
        (history.get(rootId) ?? []).filter((item) => item.logicalDate <= date),
        byId.get(rootId),
      );
      group = {
        taskId: rootId,
        title:
          rootCompletion?.title ??
          parentHistory?.title ??
          byId.get(rootId)?.title ??
          "Completed subtasks",
        completed: !!rootCompletion,
        children: [],
      };
      groups.set(rootId, group);
    }
    if (event.parentId)
      group.children.push({ taskId: event.taskId, title: event.title });
  }
  const alphabetical = (
    a: { title: string; taskId: string },
    b: { title: string; taskId: string },
  ) => a.title.localeCompare(b.title) || a.taskId.localeCompare(b.taskId);
  return [...groups.values()]
    .map((group) => ({ ...group, children: group.children.sort(alphabetical) }))
    .sort(alphabetical);
}
