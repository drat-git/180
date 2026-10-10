import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { visibleAntiItems } from "./antiRotting";
import { TASK_RETENTION_MS } from "./tasks";
import type { AntiItem, AntiLog, AntiEvent } from "./model";
const EMPTY: { items: AntiItem[]; logs: AntiLog[]; events: AntiEvent[] } = {
  items: [],
  logs: [],
  events: [],
};
export function useAntiRotting(userId: string) {
  const data =
    useLiveQuery(
      async () => ({
        items: await db.antiItems.where("userId").equals(userId).toArray(),
        logs: await db.antiLogs.where("userId").equals(userId).toArray(),
        events: await db.antiEvents.where("userId").equals(userId).toArray(),
      }),
      [userId],
    ) ?? EMPTY;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const times = data.items
      .filter((i) => i.completedAt && !i.deletedAt)
      .map((i) => Date.parse(i.completedAt!) + TASK_RETENTION_MS)
      .filter((t) => t > Date.now());
    const timer = times.length
      ? setTimeout(
          update,
          Math.min(2147483647, Math.max(1, Math.min(...times) - Date.now())),
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
  }, [data.items]);
  return { ...data, visible: visibleAntiItems(data.items, now) };
}
