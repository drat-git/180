import { addDays, logicalDate } from "./dates";
import type { ActivityTopic, DailyData, Task, TaskEvent } from "./model";

export type TaskActivityVisibility = Record<ActivityTopic, boolean>;

// Derive applicability from retained history, never from the 12-hour display list.
// No daily snapshots or background writes are needed, even for unopened days.
export function taskActivityVisibility(
  data: DailyData,
  date: string,
  today: string,
  tasks: readonly Task[],
  events: readonly TaskEvent[],
  ready = true,
): TaskActivityVisibility {
  const end = new Date(`${addDays(date, 1)}T02:00:00`).getTime();
  const history = new Map<string, TaskEvent[]>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const event of events) {
    const list = history.get(event.taskId) ?? [];
    list.push(event);
    history.set(event.taskId, list);
  }
  // Older/imported rows may have a completion timestamp without an event.
  for (const task of tasks) {
    if (!task.completedAt) continue;
    const list = history.get(task.id) ?? [];
    if (
      !list.some(
        (event) => event.type === "completed" && event.at === task.completedAt,
      )
    ) {
      list.push({
        id: `snapshot:${task.id}`,
        operationId: "snapshot",
        userId: task.userId,
        taskId: task.id,
        parentId: task.parentId,
        topic: task.topic,
        title: task.title,
        type: "completed",
        at: task.completedAt,
        logicalDate: logicalDate(new Date(task.completedAt)),
        timezone: "",
      });
      history.set(task.id, list);
    }
  }
  function latest(list: readonly TaskEvent[]): TaskEvent | undefined {
    const time = Math.max(...list.map((event) => Date.parse(event.at)));
    const tied = list.filter((event) => Date.parse(event.at) === time);
    if (tied.length < 2 || tied.every((event) => event.type === tied[0].type))
      return tied[0];
    const task = byId.get(tied[0].taskId);
    // Resolve a tied final transition from the current row when possible.
    // Ambiguous legacy history must not invent an unanswered requirement.
    if (task && Date.parse(task.updatedAt) === time)
      return tied.find(
        (event) => event.type === (task.completedAt ? "completed" : "reopened"),
      );
    return undefined;
  }
  function visible(topic: ActivityTopic) {
    if (
      data[`${topic}TasksStatus`] !== null ||
      data[`${topic}TasksReason`].trim() ||
      data[`${topic}TasksWorkedOn`].length
    )
      return true;
    if (!ready || date > today) return false;
    for (const list of history.values()) {
      const dayEvents = list.filter(
        (event) => event.topic === topic && event.logicalDate === date,
      );
      if (latest(dayEvents)?.type === "completed") return true;
    }
    return tasks.some((task) => {
      if (task.topic !== topic || task.parentId) return false;
      if (date === today) return !task.deletedAt && !task.completedAt;
      if (
        Date.parse(task.createdAt) >= end ||
        (task.deletedAt && Date.parse(task.deletedAt) < end)
      )
        return false;
      const list = history.get(task.id) ?? [];
      const beforeEnd = list.filter((event) => Date.parse(event.at) < end);
      if (beforeEnd.length) return latest(beforeEnd)?.type === "reopened";
      // Tasks are created unfinished. A first known reopening instead signals
      // missing earlier completion history, whose state we cannot reconstruct.
      const firstTime = Math.min(...list.map((event) => Date.parse(event.at)));
      return !list.some(
        (event) =>
          Date.parse(event.at) === firstTime && event.type === "reopened",
      );
    });
  }
  return { school: visible("school"), career: visible("career") };
}
