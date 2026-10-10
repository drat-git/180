import type { AntiCommand, AntiItem, AntiLog, AntiEvent } from "./model";
import { TASK_RETENTION_MS } from "./tasks";
export const antiLogId = (userId: string, itemId: string, date: string) =>
  `${userId}:${itemId}:${date}`;
export const logActive = (log: AntiLog) =>
  log.manual || !!log.completionOperationId;
export function visibleAntiItems(items: AntiItem[], now: number) {
  return items
    .filter(
      (i) =>
        !i.deletedAt &&
        (!i.completedAt || now < Date.parse(i.completedAt) + TASK_RETENTION_MS),
    )
    .sort(
      (a, b) =>
        Number(a.itemType === "reusable") - Number(b.itemType === "reusable") ||
        Number(!!a.completedAt) - Number(!!b.completedAt) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
export function antiRecap(logs: AntiLog[], events: AntiEvent[], date: string) {
  const rows = new Map<
    string,
    { itemId: string; title: string; notes: string; completed: boolean }
  >();
  for (const log of logs)
    if (log.logicalDate === date && logActive(log))
      rows.set(log.itemId, {
        itemId: log.itemId,
        title: log.title,
        notes: log.notes,
        completed: false,
      });
  const last = new Map<string, AntiEvent>();
  for (const event of events)
    if (
      event.logicalDate === date &&
      (!last.has(event.itemId) ||
        event.sequence > last.get(event.itemId)!.sequence)
    )
      last.set(event.itemId, event);
  for (const event of last.values())
    if (event.type === "completed")
      rows.set(event.itemId, {
        itemId: event.itemId,
        title: event.title,
        notes: event.notes,
        completed: true,
      });
  return [...rows.values()].sort(
    (a, b) =>
      a.title.localeCompare(b.title) || a.itemId.localeCompare(b.itemId),
  );
}
export function applyAntiCommand(
  source: { items: AntiItem[]; logs: AntiLog[]; events: AntiEvent[] },
  userId: string,
  operationId: string,
  command: AntiCommand,
) {
  const items = source.items.map((i) => ({ ...i })),
    logs = source.logs.map((l) => ({ ...l })),
    events = source.events.map((e) => ({ ...e }));
  let item = items.find((i) => i.id === command.itemId && i.userId === userId);
  const id = antiLogId(userId, command.itemId, command.logicalDate);
  let log = logs.find((l) => l.id === id);
  const snapshot = () => ({
    title: item!.title,
    notes: item!.notes,
    itemType: item!.itemType,
  });
  const ensureLog = () => {
    if (!log) {
      log = {
        id,
        userId,
        itemId: command.itemId,
        logicalDate: command.logicalDate,
        ...snapshot(),
        manual: false,
        completionOperationId: null,
        at: command.at,
        timezone: command.timezone,
        revision: 0,
      };
      logs.push(log);
    }
    // Re-logging an explicitly removed record uses the current description.
    if (!logActive(log))
      Object.assign(log, snapshot(), {
        at: command.at,
        timezone: command.timezone,
      });
    return log;
  };
  const transition = (completed: boolean) => {
    if (!item || !!item.completedAt === completed) return;
    item.revision++;
    if (completed) {
      const l = ensureLog();
      l.completionOperationId = operationId;
      l.revision++;
    } else if (log?.completionOperationId === item.completionOperationId) {
      log.completionOperationId = null;
      log.revision++;
    }
    item.completedAt = completed ? command.at : null;
    item.completionOperationId = completed ? operationId : null;
    events.push({
      id: `${operationId}:${item.id}`,
      operationId,
      userId,
      itemId: item.id,
      ...snapshot(),
      type: completed ? "completed" : "reopened",
      at: command.at,
      logicalDate: command.logicalDate,
      timezone: command.timezone,
      sequence: item.revision,
    });
  };
  if (command.action === "create" || command.action === "edit") {
    const title = command.title?.trim();
    if (
      !title ||
      title.length > 500 ||
      (command.notes ?? "").length > 5000 ||
      !["reusable", "one-time"].includes(command.itemType ?? "")
    )
      throw new Error(
        "Enter a title of 1–500 characters and notes of up to 5,000 characters.",
      );
    if (command.action === "create") {
      if (item) return { items, logs, events };
      item = {
        id: command.itemId,
        userId,
        title,
        notes: command.notes ?? "",
        itemType: command.itemType!,
        completedAt: null,
        completionOperationId: null,
        deletedAt: null,
        createdAt: command.at,
        updatedAt: command.at,
        revision: 0,
      };
      items.push(item);
    } else if (item && !item.deletedAt) {
      if (command.itemType === "reusable") transition(false);
      Object.assign(item, {
        title,
        notes: command.notes ?? "",
        itemType: command.itemType,
        updatedAt: command.at,
        revision: item.revision + 1,
      });
    }
  } else if (command.action === "log") {
    // Removing a log remains possible after its item is deleted or archived.
    if (command.logged) {
      if (!item || item.deletedAt) return { items, logs, events };
      ensureLog().manual = true;
      log!.revision++;
    } else if (log) {
      log.manual = false;
      log.completionOperationId = null;
      log.revision++;
    }
  } else if (item && !item.deletedAt) {
    if (command.action === "complete" && item.itemType === "one-time")
      transition(!!command.completed);
    if (command.action === "delete") {
      item.deletedAt = command.at;
      item.revision++;
    }
    item.updatedAt = command.at;
  }
  return { items, logs, events };
}
