import { db, type AppDatabase } from "./db";
import { modeForUser } from "./appMode";
import { addDays } from "./dates";
import {
  taskActivityVisibility,
  latestTaskEvent,
  retainedTaskEvents,
} from "./taskActivityVisibility";
import { mergeTaskSelections } from "./taskDaily";
import {
  emptyData,
  type DailyData,
  type Task,
  type TaskEvent,
  type TaskCommand,
  type TaskChecklistLink,
} from "./model";
import type {
  Configuration,
  ConfigurationPatch,
  ConfigChange,
  ItemAnswer,
  ItemAnswers,
  ChecklistItem,
  CustomAnswerRecord,
} from "./customizationTypes";
import {
  resolveConfiguration,
  legacyItemAnswer,
  itemAnswerKey,
  emptyItemAnswer,
  evaluateItem,
} from "./customization";

export function configurationRevision(changes: ConfigChange[]) {
  return Math.max(
    0,
    ...changes
      .filter((change) => !change.conflict)
      .map((change) => change.sequence),
  );
}
export function diffConfiguration(
  before: Configuration,
  after: Configuration,
): ConfigurationPatch {
  const patch: ConfigurationPatch = {};
  for (const key of ["blocks", "items", "lists"] as const) {
    const updates: { id: string; [field: string]: unknown }[] = [];
    for (const entity of after[key]) {
      const old = before[key].find((value) => value.id === entity.id);
      const changed: { id: string; [field: string]: unknown } = {
        id: entity.id,
      };
      for (const field of Object.keys(entity)) {
        if (field === "id") continue;
        const value = (entity as unknown as Record<string, unknown>)[field];
        if (
          !old ||
          JSON.stringify(value) !==
            JSON.stringify((old as unknown as Record<string, unknown>)[field])
        )
          changed[field] = value;
      }
      // Explicit empty values are needed to remove optional schedules/settings.
      if (old)
        for (const field of Object.keys(old))
          if (!(field in entity) && field !== "id") changed[field] = null;
      if (Object.keys(changed).length > 1) updates.push(changed);
    }
    for (const old of before[key])
      if (!after[key].some((value) => value.id === old.id))
        updates.push({ id: old.id, deleted: true });
    if (updates.length) (patch as Record<string, unknown>)[key] = updates;
  }
  return patch;
}
export function mergeAnswer(
  current: ItemAnswer,
  patch: Partial<ItemAnswer>,
): ItemAnswer {
  return {
    ...current,
    ...patch,
    fields: { ...current.fields, ...patch.fields },
  };
}
export function answerPatch(
  before: ItemAnswer,
  after: ItemAnswer,
): Partial<ItemAnswer> {
  const result: Partial<ItemAnswer> = {};
  if (JSON.stringify(before.value) !== JSON.stringify(after.value))
    result.value = after.value;
  if (JSON.stringify(before.selections) !== JSON.stringify(after.selections))
    result.selections = after.selections;
  const fields = Object.fromEntries(
    Object.entries(after.fields).filter(
      ([key, value]) =>
        JSON.stringify(before.fields[key]) !== JSON.stringify(value),
    ),
  );
  if (Object.keys(fields).length) result.fields = fields;
  return result;
}
export function dayAnswers(
  configuration: Configuration,
  data: DailyData,
  records: CustomAnswerRecord[],
): ItemAnswers {
  const answers: ItemAnswers = {};
  for (const item of configuration.items)
    answers[itemAnswerKey(item.id, item.generation)] = legacyItemAnswer(
      item,
      data,
    );
  for (const record of records) {
    const key = itemAnswerKey(record.itemId, record.generation);
    answers[key] = answers[key]
      ? {
          ...record.value,
          fields: { ...answers[key].fields, ...record.value.fields },
        }
      : record.value;
  }
  return answers;
}
export function taskQuestionRelevance(
  item: ChecklistItem,
  answer: ItemAnswer,
  userId: string,
  date: string,
  today: string,
  tasks: Task[],
  events: TaskEvent[],
) {
  if (item.kind !== "tasks" || !item.listId) return true;
  if (
    answer.value !== null ||
    answer.selections.length ||
    Object.values(answer.fields).some(
      (value) => typeof value === "string" && value.trim(),
    )
  )
    return true;
  const topic = item.listId;
  if (topic === "school" || topic === "career")
    return taskActivityVisibility(
      emptyData(),
      date,
      today,
      tasks,
      events,
      true,
      modeForUser(userId),
    )[topic];
  const owned = tasks.filter(
    (task) => task.userId === userId && task.topic === topic,
  );
  const byId = new Map(owned.map((task) => [task.id, task]));
  const history = retainedTaskEvents(
    owned,
    events.filter((event) => event.userId === userId && event.topic === topic),
    modeForUser(userId),
  );
  if (
    history.some(
      (event) =>
        event.logicalDate === date &&
        latestTaskEvent(
          history.filter(
            (other) =>
              other.taskId === event.taskId && other.logicalDate === date,
          ),
          byId.get(event.taskId),
        )?.type === "completed",
    )
  )
    return true;
  if (date === today)
    return owned.some(
      (task) => !task.parentId && !task.deletedAt && !task.completedAt,
    );
  const boundary = new Date(
    `${addDays(date, 1)}T02:00:00${modeForUser(userId).demo ? "-04:00" : ""}`,
  ).getTime();
  return owned.some((task) => {
    if (
      task.parentId ||
      Date.parse(task.createdAt) >= boundary ||
      (task.deletedAt && Date.parse(task.deletedAt) < boundary)
    )
      return false;
    const transitions = history.filter(
      (event) => event.taskId === task.id && Date.parse(event.at) < boundary,
    );
    return transitions.length
      ? latestTaskEvent(transitions, task)?.type === "reopened"
      : !task.completedAt || Date.parse(task.completedAt) >= boundary;
  });
}
export function captureTaskLink(
  userId: string,
  date: string,
  topic: string,
  changes: ConfigChange[],
): TaskChecklistLink | null {
  const config = resolveConfiguration(userId, date, changes);
  if (!config.lists.some((list) => list.id === topic && !list.deleted))
    return null;
  const item = config.items.find(
    (item) =>
      item.kind === "tasks" &&
      item.listId === topic &&
      !item.deleted &&
      evaluateItem(item, emptyItemAnswer(item), date, {
        block: config.blocks.find((block) => block.id === item.blockId),
        relevant: true,
      }).visible,
  );
  return item
    ? {
        itemId: item.id,
        generation: item.generation,
        listId: topic,
        configurationRevision: configurationRevision(changes),
      }
    : null;
}
export async function applyTaskAnswer(
  database: AppDatabase,
  userId: string,
  date: string,
  operationId: string,
  command: TaskCommand,
  tasks: Task[],
  events: TaskEvent[],
  createdAt: string,
  captured?: import("./model").PendingOperation["customTaskChange"],
) {
  const link = command.checklistLink;
  if (!link || command.action !== "complete") return;
  const event = events.find((event) => event.taskId === command.taskId);
  const parent = event
    ? tasks.find((task) => task.id === (event.parentId ?? event.taskId))
    : undefined;
  const change =
    captured ??
    (event && parent
      ? {
          parent: { taskId: parent.id, title: parent.title },
          ...(event.parentId
            ? { child: { taskId: event.taskId, title: event.title } }
            : {}),
          completed: event.type === "completed",
        }
      : undefined);
  if (!change) return;
  const key: [string, string, string, number] = [
    userId,
    date,
    link.itemId,
    link.generation,
  ];
  const existing = await database.customAnswers.get(key);
  const changes = await database.configurations
    .where("userId")
    .equals(userId)
    .toArray();
  const item = resolveConfiguration(userId, date, changes).items.find(
    (item) => item.id === link.itemId && item.generation === link.generation,
  );
  const legacy =
    (await database.entries.get([userId, date]))?.data ?? emptyData();
  const value =
    existing?.value ??
    (item
      ? legacyItemAnswer(item, legacy)
      : {
          generation: link.generation,
          value: null,
          fields: {},
          selections: [],
        });
  const selections = mergeTaskSelections(
    value.selections,
    { topic: "school", ...change },
    operationId,
  );
  if (
    !change.completed &&
    JSON.stringify(selections) === JSON.stringify(value.selections)
  )
    return;
  await database.customAnswers.put({
    userId,
    logicalDate: date,
    itemId: link.itemId,
    generation: link.generation,
    value: {
      ...value,
      selections,
      value: change.completed || selections.length ? true : null,
    },
    revision: existing?.revision ?? 0,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
  });
}
export async function configurationFor(
  userId: string,
  date: string,
  database: AppDatabase = db,
) {
  const changes = await database.configurations
    .where("userId")
    .equals(userId)
    .toArray();
  return {
    configuration: resolveConfiguration(userId, date, changes),
    changes,
    revision: configurationRevision(changes),
  };
}
