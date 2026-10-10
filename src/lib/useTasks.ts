import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import type { Task } from "./model";
const EMPTY_TASKS: Task[] = [];
import { TASK_RETENTION_MS, visibleRoots } from "./tasks";

export function useTasks(userId: string) {
  const tasks =
    useLiveQuery(
      () => db.tasks.where("userId").equals(userId).toArray(),
      [userId],
    ) ?? EMPTY_TASKS;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
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
  }, [tasks]);
  return { tasks, roots: visibleRoots(tasks, now) };
}
