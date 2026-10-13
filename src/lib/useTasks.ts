import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import type { Task, TaskEvent } from "./model";
const EMPTY_TASKS: Task[] = [];
const EMPTY_EVENTS: TaskEvent[] = [];
import { TASK_RETENTION_MS, visibleRoots } from "./tasks";
import { clockForUser, isDemoUser } from "./appMode";

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
  const [now, setNow] = useState(() => clockForUser(userId).getTime());
  useEffect(() => {
    if (isDemoUser(userId)) {
      setNow(clockForUser(userId).getTime());
      return;
    }
    const update = () => setNow(Date.now());
    const next = tasks
      .filter((t) => !t.parentId && t.completedAt && !t.deletedAt)
      .map((t) => Date.parse(t.completedAt!) + TASK_RETENTION_MS)
      .filter((t) => t > Date.now());
    const timer = next.length
      ? setTimeout(
          update,
          Math.min(2147483647, Math.max(1, Math.min(...next) - Date.now())),
        )
      : undefined;
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
    tasks,
    events,
    ready: snapshot !== undefined,
    roots: visibleRoots(tasks, now),
  };
}
