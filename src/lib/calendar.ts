import { addDays, dateOrdinal, weekday } from "./dates";
import { checklistProgress, type ChecklistProgress } from "./checklist";
import { type AppMode } from "./appMode";
import {
  emptyData,
  type DailyData,
  type DailyEntry,
  type JournalImage,
  type Task,
  type TaskEvent,
  type TaskTopic,
  type AntiLog,
  type AntiEvent,
} from "./model";
import { antiRecap } from "./antiRotting";
import {
  latestTaskEvent,
  retainedTaskEvents,
  taskActivityVisibility,
} from "./taskActivityVisibility";

export const CALENDAR_BANDS = [
  "0%",
  "1–24%",
  "25–49%",
  "50–74%",
  "75–99%",
  "100%",
] as const;
export type CompletionBand = 0 | 1 | 2 | 3 | 4 | 5;
export function completionBand(
  completed: number,
  total: number,
): CompletionBand | null {
  if (total <= 0) return null;
  if (completed <= 0) return 0;
  if (completed >= total) return 5;
  if (completed * 4 < total) return 1;
  if (completed * 2 < total) return 2;
  if (completed * 4 < total * 3) return 3;
  return 4;
}
export function completionPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return completed >= total
    ? 100
    : Math.min(99, Math.round((completed / total) * 100));
}
export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
}
export function monthDates(month: string): string[] {
  const first = `${month}-01`;
  const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const start = addDays(first, -weekday(first));
  const last = addDays(end, 6 - weekday(end));
  return Array.from(
    { length: dateOrdinal(last) - dateOrdinal(start) + 1 },
    (_, index) => addDays(start, index),
  );
}

export interface CalendarWorkedTask {
  taskId: string;
  title: string;
  workedOn: boolean;
  children: { taskId: string; title: string }[];
}
export interface CalendarDaySummary extends ChecklistProgress {
  date: string;
  recorded: boolean;
  band: CompletionBand | null;
  percentage: number;
  workedOn: Record<TaskTopic, CalendarWorkedTask[]>;
  antiRotting: ReturnType<typeof antiRecap>;
}
export interface CalendarSnapshot {
  entries: DailyEntry[];
  tasks: Task[];
  events: TaskEvent[];
  images: JournalImage[];
  antiLogs: AntiLog[];
  antiEvents: AntiEvent[];
}

function hasContent(data: DailyData) {
  const blank = emptyData();
  return (Object.keys(blank) as (keyof DailyData)[]).some((key) => {
    const value = data[key];
    if (typeof value === "string") return value.trim().length > 0;
    return JSON.stringify(value) !== JSON.stringify(blank[key]);
  });
}

export function calendarDaySummary(
  snapshot: CalendarSnapshot,
  userId: string,
  date: string,
  today: string,
  mode: AppMode,
): CalendarDaySummary {
  // Keep this boundary account-safe even when invoked with a mixed snapshot.
  const tasks = snapshot.tasks.filter((task) => task.userId === userId);
  const events = retainedTaskEvents(
    tasks,
    snapshot.events.filter((event) => event.userId === userId),
    mode,
  );
  const data = {
    ...emptyData(),
    ...snapshot.entries.find(
      (entry) => entry.userId === userId && entry.logicalDate === date,
    )?.data,
  };
  const activity = taskActivityVisibility(
    data,
    date,
    today,
    tasks,
    events,
    true,
    mode,
  );
  const progress = checklistProgress(data, date, activity, mode);
  const recorded =
    hasContent(data) ||
    snapshot.images.some(
      (image) =>
        image.userId === userId &&
        image.logicalDate === date &&
        !image.deletedAt,
    );
  const groups: Record<TaskTopic, Map<string, CalendarWorkedTask>> = {
    school: new Map(),
    career: new Map(),
    life: new Map(),
  };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const titles = new Map<string, string>();
  for (const topic of ["school", "career"] as const) {
    for (const selection of data[`${topic}TasksWorkedOn`]) {
      titles.set(selection.taskId, selection.title);
      for (const child of selection.children)
        titles.set(child.taskId, child.title);
      if (data[`${topic}TasksStatus`] !== true) continue;
      groups[topic].set(selection.taskId, {
        taskId: selection.taskId,
        title: selection.title,
        workedOn: selection.manual !== false || !!selection.automatic,
        children: selection.children.map(({ taskId, title }) => ({
          taskId,
          title,
        })),
      });
    }
  }
  const dayEvents = new Map<string, TaskEvent[]>();
  for (const event of events) {
    if (event.logicalDate !== date) continue;
    const list = dayEvents.get(event.taskId) ?? [];
    list.push(event);
    dayEvents.set(event.taskId, list);
  }
  for (const list of dayEvents.values()) {
    const event = latestTaskEvent(list, byId.get(list[0].taskId));
    if (event?.type !== "completed") continue;
    const rootId = event.parentId ?? event.taskId;
    let group = groups[event.topic].get(rootId);
    if (!group) {
      // Parent titles are not always captured when only a child is completed.
      // Use a saved title where available, rather than a later renamed row.
      const parentEvent = latestTaskEvent(
        events.filter(
          (item) => item.taskId === rootId && item.logicalDate <= date,
        ),
        byId.get(rootId),
      );
      group = {
        taskId: rootId,
        title:
          titles.get(rootId) ??
          (event.parentId ? (parentEvent?.title ?? "Subtasks") : event.title),
        workedOn: false,
        children: [],
      };
      groups[event.topic].set(rootId, group);
    }
    if (!event.parentId) {
      group.workedOn = true;
      group.title = titles.get(rootId) ?? event.title;
    } else if (!group.children.some((child) => child.taskId === event.taskId)) {
      group.children.push({ taskId: event.taskId, title: event.title });
    }
  }
  return {
    ...progress,
    date,
    recorded,
    band: recorded ? completionBand(progress.completed, progress.total) : null,
    percentage: completionPercent(progress.completed, progress.total),
    workedOn: {
      school: [...groups.school.values()],
      career: [...groups.career.values()],
      life: [...groups.life.values()],
    },
    antiRotting: antiRecap(
      snapshot.antiLogs.filter((log) => log.userId === userId),
      snapshot.antiEvents.filter((event) => event.userId === userId),
      date,
    ),
  };
}
