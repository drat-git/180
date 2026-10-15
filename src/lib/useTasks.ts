import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import type { Task, TaskEvent } from "./model";
const EMPTY_TASKS: Task[] = [];
const EMPTY_EVENTS: TaskEvent[] = [];
import { TASK_RETENTION_MS, visibleRoots } from "./tasks";
import { clockForUser, isDemoUser, timezoneForUser } from "./appMode";
import { addDays } from "./dates";
import {
  deadlineDayStart,
  deadlineInstant,
  deadlineLocalParts,
} from "./taskDeadlines";

export function useTasks(userId: string) {
  const snapshot = useLiveQuery(
    () =>
      db.transaction("r", db.tasks, db.taskEvents, async () => {
        const [tasks, events] = await Promise.all([
          db.tasks.where("userId").equals(userId).toArray(),
          db.taskEvents.where("userId").equals(userId).toArray(),
        ]);
        return { tasks, events };
      }),
    [userId],
  );
  const tasks = snapshot?.tasks ?? EMPTY_TASKS;
  const events = snapshot?.events ?? EMPTY_EVENTS;
  const [{ now, timezone }, setClock] = useState(() => ({
    now: clockForUser(userId).getTime(),
    timezone: timezoneForUser(userId),
  }));
  useEffect(() => {
    if (isDemoUser(userId)) {
      setClock({
        now: clockForUser(userId).getTime(),
        timezone: timezoneForUser(userId),
      });
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const stamp = Date.now(),
        timezone = timezoneForUser(userId);
      setClock({ now: stamp, timezone });
      const next = [
        deadlineDayStart(
          addDays(deadlineLocalParts(stamp, timezone).date, 1),
          timezone,
        ),
        ...tasks
          .filter((task) => !task.parentId && !task.deletedAt)
          .map((task) =>
            task.completedAt
              ? Date.parse(task.completedAt) + TASK_RETENTION_MS
              : deadlineInstant(task.deadline, timezone),
          ),
      ].filter((value) => Number.isFinite(value) && value > stamp);
      timer = setTimeout(
        update,
        Math.min(2147483647, Math.max(1, Math.min(...next) - stamp)),
      );
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [tasks, userId]);
  return {
    now,
    timezone,
    tasks,
    events,
    ready: snapshot !== undefined,
    roots: visibleRoots(tasks, now, timezone),
  };
}
