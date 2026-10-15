import { addDays, dateOrdinal, weekday } from "./dates";
import { type ChecklistProgress } from "./checklist";
import {
  answersForConfiguration,
  customChecklistProgress,
  defaultConfiguration,
  itemAnswerKey,
  LEGACY_BLOCK_TITLES,
  listActivityRelevant,
  resolveConfiguration,
} from "./customization";
import type {
  ConfigChange,
  CustomAnswerRecord,
  ItemAnswers,
} from "./customizationTypes";
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
import { deadlineInput } from "./taskDeadlines";
import { sortTasks } from "./tasks";
import { latestTaskEvent, retainedTaskEvents } from "./taskActivityVisibility";

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

export function calendarDueTasks(
  tasks: Task[],
  userId: string,
  timezone: string,
  activeListIds?: ReadonlySet<string>,
) {
  const days = new Map<string, Task[]>();
  for (const task of sortTasks(
    tasks.filter(
      (task) =>
        task.userId === userId &&
        (!activeListIds || activeListIds.has(task.topic)) &&
        !task.parentId &&
        !task.deletedAt &&
        !task.completedAt &&
        task.deadline,
    ),
    timezone,
  )) {
    const date = deadlineInput(task.deadline, timezone).date;
    const group = days.get(date) ?? [];
    group.push(task);
    days.set(date, group);
  }
  return days;
}

export interface CalendarWorkedTask {
  taskId: string;
  title: string;
  workedOn: boolean;
  children: { taskId: string; title: string }[];
}
export interface CalendarDaySummary extends ChecklistProgress {
  categories: { id: string; title: string; completed: number; total: number }[];
  date: string;
  recorded: boolean;
  band: CompletionBand | null;
  percentage: number;
  workedOn: Record<TaskTopic, CalendarWorkedTask[]>;
  antiRotting: ReturnType<typeof antiRecap>;
}
export interface CalendarSnapshot {
  configurations?: ConfigChange[];
  customAnswers?: CustomAnswerRecord[];
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
  const changes = snapshot.configurations ?? [];
  const configuration = changes.length
    ? resolveConfiguration(userId, date, changes)
    : defaultConfiguration(userId, date, mode);
  const records = (snapshot.customAnswers ?? []).filter(
    (record) => record.userId === userId && record.logicalDate === date,
  );
  const custom: ItemAnswers = Object.fromEntries(
    records.map((record) => [
      itemAnswerKey(record.itemId, record.generation),
      record.value,
    ]),
  );
  const answers = answersForConfiguration(configuration, data, custom);
  const relevance = Object.fromEntries(
    configuration.items
      .filter((item) => item.kind === "tasks" && item.listId)
      .map((item) => {
        const list = configuration.lists.find(
          (list) => list.id === item.listId,
        );
        const relevantTasks = date === today && list?.deleted ? [] : tasks;
        return [
          item.id,
          listActivityRelevant(
            item.listId!,
            answers[itemAnswerKey(item)],
            date,
            today,
            relevantTasks,
            events,
            true,
            mode,
          ),
        ];
      }),
  );
  const counts = customChecklistProgress(
    configuration,
    answers,
    date,
    relevance,
  );
  const progress = {
    ...counts,
    blocks: {
      ...Object.fromEntries(
        Object.entries(LEGACY_BLOCK_TITLES).map(([id, title]) => [
          title,
          counts.blocks[id] ?? { completed: 0, total: 0 },
        ]),
      ),
      ...Object.fromEntries(
        configuration.blocks
          .filter((block) => !Object.hasOwn(LEGACY_BLOCK_TITLES, block.id))
          .map((block) => [block.id, counts.blocks[block.id]]),
      ),
    },
  };
  const categories = [...configuration.blocks]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .filter((block) => !block.deleted)
    .map((block) => ({
      id: block.id,
      title: block.title,
      ...counts.blocks[block.id],
    }));
  const recorded =
    hasContent(data) ||
    records.some(
      (record) =>
        record.value.value !== null ||
        record.value.selections.length > 0 ||
        Object.values(record.value.fields).some((value) =>
          typeof value === "string"
            ? !!value.trim()
            : Array.isArray(value)
              ? value.some((entry) => !!entry.trim())
              : value !== null,
        ),
    ) ||
    snapshot.images.some(
      (image) =>
        image.userId === userId &&
        image.logicalDate === date &&
        !image.deletedAt,
    );
  const groups: Record<
    TaskTopic,
    Map<string, CalendarWorkedTask>
  > = Object.assign(Object.create(null), {
    school: new Map(),
    career: new Map(),
    life: new Map(),
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const titles = new Map<string, string>();
  const groupFor = (topic: string) => {
    if (!groups[topic]) groups[topic] = new Map();
    return groups[topic];
  };
  for (const list of configuration.lists) groupFor(list.id);
  const taskAnswers = configuration.items
    .filter((item) => item.kind === "tasks" && item.listId)
    .map((item) => ({ item, answer: answers[itemAnswerKey(item)] }));
  // A same-day schema edit can retire an answer generation; its recorded work remains history.
  for (const record of records) {
    if (
      taskAnswers.some(
        ({ item }) =>
          item.id === record.itemId && item.generation === record.generation,
      )
    )
      continue;
    const applicable = changes
      .filter(
        (change) =>
          change.userId === userId &&
          !change.conflict &&
          change.effectiveDate <= date,
      )
      .sort((a, b) => a.sequence - b.sequence);
    for (let index = applicable.length; index >= 0; index--) {
      const historical = resolveConfiguration(
        userId,
        date,
        applicable.slice(0, index),
      ).items.find(
        (item) =>
          item.id === record.itemId &&
          item.generation === record.generation &&
          item.kind === "tasks" &&
          item.listId,
      );
      if (historical) {
        taskAnswers.push({ item: historical, answer: record.value });
        break;
      }
    }
  }
  for (const { item, answer } of taskAnswers) {
    for (const selection of answer.selections) {
      titles.set(selection.taskId, selection.title);
      for (const child of selection.children)
        titles.set(child.taskId, child.title);
      if (answer.value !== true) continue;
      const group = groupFor(item.listId!);
      const existing = group.get(selection.taskId);
      const children = [...(existing?.children ?? [])];
      for (const child of selection.children)
        if (!children.some((entry) => entry.taskId === child.taskId))
          children.push({ taskId: child.taskId, title: child.title });
      group.set(selection.taskId, {
        taskId: selection.taskId,
        title: selection.title,
        workedOn:
          !!existing?.workedOn ||
          selection.manual !== false ||
          !!selection.automatic,
        children,
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
    let group = groupFor(event.topic).get(rootId);
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
      groupFor(event.topic).set(rootId, group);
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
    categories,
    date,
    recorded,
    band: recorded ? completionBand(progress.completed, progress.total) : null,
    percentage: completionPercent(progress.completed, progress.total),
    workedOn: Object.fromEntries(
      Object.entries(groups).map(([topic, group]) => [
        topic,
        [...group.values()],
      ]),
    ),
    antiRotting: antiRecap(
      snapshot.antiLogs.filter((log) => log.userId === userId),
      snapshot.antiEvents.filter((event) => event.userId === userId),
      date,
    ),
  };
}
