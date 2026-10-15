import { addDays, weekday } from "./dates";
import { modeForUser, PRIVATE_MODE, type AppMode } from "./appMode";
import {
  CREATINE_START_DATE,
  FOOD_UPDATE_DATE,
  binaryFields,
  timeMinutes,
  type DailyData,
  type Task,
  type TaskEvent,
} from "./model";
import { latestTaskEvent, retainedTaskEvents } from "./taskActivityVisibility";
import type {
  AnswerValue,
  ChecklistBlockDefinition,
  ChecklistItem,
  ConfigChange,
  Configuration,
  ConfigurationPatch,
  CustomChecklistProgress,
  FollowupDefinition,
  ItemAnswer,
  ItemAnswers,
  ItemEvaluation,
  ItemKind,
  Rule,
  Schedule,
} from "./customizationTypes";
export type * from "./customizationTypes";

const yes: Rule = { op: "equals", field: "value", value: true };
const no: Rule = { op: "equals", field: "value", value: false };
const note = (condition: Rule = no): FollowupDefinition => ({
  id: "reason",
  kind: "note",
  label: "Why?",
  condition,
  placeholder: "A little context, if you want.",
  initiallyExpanded: true,
});
const foodNote: FollowupDefinition = {
  id: "description",
  kind: "note",
  label: "What did you eat?",
  condition: yes,
  placeholder: "Just a quick description",
  initiallyExpanded: true,
};
const count = (label: string): FollowupDefinition => ({
  id: "count",
  kind: "counter",
  label,
  condition: yes,
  min: 1,
  max: 2147483647,
  defaultValue: 1,
});
export const LEGACY_BLOCK_TITLES: Record<string, string> = {
  general: "General",
  school: "School",
  career: "Career",
  food: "Food",
  body: "Body",
};
export function itemAnswerKey(
  id: string | Pick<ChecklistItem, "id" | "generation">,
  generation?: number,
): string {
  return typeof id === "string"
    ? `${id}@${generation ?? 1}`
    : `${id.id}@${id.generation}`;
}

export function defaultCompletionRule(kind: ItemKind): Rule {
  return kind === "checkbox" || kind === "boolean" || kind === "tasks"
    ? { ...yes }
    : { op: "not-empty", field: "value" };
}

/** Built-in templates are ordinary definitions, including their historical cutovers. */
export function defaultConfiguration(
  userId: string,
  date: string,
  mode: AppMode = modeForUser(userId),
): Configuration {
  const modern = mode.modernFood || date >= FOOD_UPDATE_DATE;
  const blocks: ChecklistBlockDefinition[] = [
    { id: "general", title: "General", icon: "compass", order: 0 },
    { id: "school", title: "School", icon: "graduation-cap", order: 1 },
    { id: "career", title: "Career", icon: "briefcase", order: 2 },
    { id: "food", title: "Diet", icon: "utensils", order: 3 },
    { id: "body", title: "Body", icon: "activity", order: 4 },
  ];
  const item = (
    id: string,
    blockId: string,
    label: string,
    order: number,
    extra: Partial<ChecklistItem> = {},
  ): ChecklistItem => ({
    id,
    blockId,
    label,
    kind: "boolean",
    generation: 1,
    order,
    completion: { ...yes },
    followups: [note()],
    legacyKey: id,
    ...extra,
  });
  const wakeRule: Rule = {
    op: "compare",
    field: "value",
    operator: "lte",
    value: mode.wakeMinutes,
  };
  const screenRule: Rule = {
    op: "compare",
    field: "value",
    operator: "lte",
    value: 210,
  };
  const cannabisRule: Rule =
    mode.cannabisUseLimit === null
      ? { ...no }
      : {
          op: "any",
          rules: [
            no,
            {
              op: "all",
              rules: [
                yes,
                {
                  op: "compare",
                  field: "count",
                  operator: "lte",
                  value: mode.cannabisUseLimit,
                },
              ],
            },
          ],
        };
  const items: ChecklistItem[] = [
    item("wake", "general", "Wake-up time", 0, {
      kind: "time",
      completion: wakeRule,
      followups: [
        note({
          op: "compare",
          field: "value",
          operator: "gt",
          value: mode.wakeMinutes,
        }),
      ],
    }),
    item("screenTime", "general", "Screen time", 1, {
      kind: "duration",
      min: 0,
      max: 1440,
      completion: screenRule,
      followups: [
        note({ op: "compare", field: "value", operator: "gt", value: 210 }),
      ],
    }),
    item("cannabis", "general", mode.labels.cannabis ?? "Used cannabis?", 2, {
      completion: cannabisRule,
      followups: [
        count("How many times?"),
        {
          id: "occurrences",
          kind: "occurrences",
          label: "Use",
          condition: yes,
          countField: "count",
          initiallyExpanded: true,
          placeholder: "Any details you’d like to record.",
        },
      ],
    }),
    item("classAttendance", "school", "Attended class", 0, {
      schedule: { weekdays: [1, 2, 3, 4, 5] },
    }),
    item("schoolTasks", "school", "Worked on school tasks", 1, {
      kind: "tasks",
      listId: "school",
      visibility: "relevant",
    }),
    item("applications", "career", "Applied to jobs or internships", 0, {
      followups: [count("How many applications?"), note()],
    }),
    item("careerTasks", "career", "Worked on career tasks", 1, {
      kind: "tasks",
      listId: "career",
      visibility: "relevant",
    }),
  ];
  items.push(
    item("amBreakfast", "food", mode.breakfastLabel, 0, {
      schedule: mode.modernFood ? undefined : { startDate: FOOD_UPDATE_DATE },
      followups: [
        {
          id: "choice",
          kind: "choice",
          label: "Choose one (required)",
          condition: yes,
          required: true,
          displayChoiceLabel: true,
          resetOnAnswer: true,
          options: [
            { id: "shake", label: mode.breakfastLabels.shake },
            { id: "meal", label: mode.breakfastLabels.meal },
          ],
        },
        {
          ...foodNote,
          condition: {
            op: "all",
            rules: [yes, { op: "equals", field: "choice", value: "meal" }],
          },
        },
        note(),
      ],
    }),
  );
  for (const id of [
    "meal1",
    "meal2",
    "snack1",
    "snack2",
    "shake",
    "snack",
  ] as const) {
    const field = binaryFields.find((entry) => entry.key === id)!;
    const label =
      mode.labels[id] ??
      (modern
        ? ((
            { meal1: "Lunch", meal2: "Dinner", shake: "PM Shake" } as Partial<
              Record<typeof id, string>
            >
          )[id] ?? field.label)
        : field.label);
    const oldOnly = id === "snack1" || id === "snack2";
    const schedule = oldOnly
      ? {
          endDate: mode.modernFood
            ? "0001-01-01"
            : addDays(FOOD_UPDATE_DATE, -1),
        }
      : id === "snack" && !mode.modernFood
        ? { startDate: FOOD_UPDATE_DATE }
        : undefined;
    const order = modern
      ? ["amBreakfast", "meal1", "meal2", "shake", "snack"].indexOf(id)
      : ["meal1", "meal2", "snack1", "snack2", "shake"].indexOf(id);
    items.push(
      item(id, "food", label, order < 0 ? 99 : order, {
        schedule,
        followups: [
          ...("description" in field ? [{ ...foodNote }] : []),
          note(),
        ],
        ...(id === "snack" ? { helper: "Fruit, protein bar, boba, etc" } : {}),
      }),
    );
  }
  for (const [order, key] of mode.bodyFields.entries()) {
    const field = binaryFields.find((entry) => entry.key === key)!;
    items.push(
      item(key, "body", mode.labels[key] ?? field.label, order, {
        ...(key === "creatine" && !mode.demo
          ? { schedule: { startDate: CREATINE_START_DATE } }
          : {}),
      }),
    );
  }
  for (const entry of items) {
    if (entry.id === "wake") entry.inputId = "wake";
    if (entry.id === "screenTime") entry.inputId = "screen";
    const original = binaryFields.find(
      (field) => field.key === entry.legacyKey,
    );
    for (const field of entry.followups) {
      if (field.id === "reason") {
        field.ariaLabel = `${entry.label} reason`;
        field.addLabel = "Why? Add reason";
        field.viewLabel = "View reason";
        field.preferenceKey =
          entry.id === "applications"
            ? "Applied to jobs or internships? reason"
            : entry.id === "amBreakfast"
              ? mode.demo
                ? "Breakfast reason"
                : "AM Shake/Calorie-Dense Breakfast reason"
              : entry.kind === "tasks"
                ? `${entry.label}? reason`
                : `${original?.label ?? entry.label} reason`;
      }
      if (field.id === "description") {
        field.addLabel = "What did you eat? Add description";
        field.viewLabel = "View food description";
        field.ariaLabel =
          entry.id === "amBreakfast"
            ? `${mode.demo ? "Meal" : "Calorie dense meal"} food description`
            : `${entry.label} food description`;
        field.preferenceKey =
          entry.id === "amBreakfast"
            ? "am-breakfast-food-description"
            : `${original?.label ?? entry.label} food description`;
      }
      if (field.id === "occurrences") {
        field.ariaLabel = `${mode.demo ? "Vaping" : "Cannabis"} use {n} description`;
        field.preferenceKey = "cannabis-use-descriptions";
      }
    }
  }
  return {
    blocks,
    items,
    lists: [
      { id: "school", title: "School", icon: "graduation-cap", order: 0 },
      { id: "career", title: "Career", icon: "briefcase", order: 1 },
      { id: "life", title: "Life", icon: "heart", order: 2 },
    ],
  };
}

function mergeEntities<T extends { id: string }>(
  source: T[],
  patches: (Partial<T> & { id: string })[] = [],
): T[] {
  const result = source.map((value) => structuredClone(value));
  for (const patch of patches) {
    const index = result.findIndex((value) => value.id === patch.id);
    if (index < 0) result.push(structuredClone(patch) as T);
    else result[index] = { ...result[index], ...structuredClone(patch) };
  }
  return result;
}
export function applyConfigurationPatch(
  configuration: Configuration,
  patch: ConfigurationPatch,
): Configuration {
  return {
    blocks: mergeEntities(configuration.blocks, patch.blocks),
    items: mergeEntities(configuration.items, patch.items),
    lists: mergeEntities(configuration.lists, patch.lists),
  };
}
export function resolveConfiguration(
  userId: string,
  date: string,
  changes: readonly ConfigChange[],
): Configuration {
  let configuration = defaultConfiguration(userId, date);
  const applicable = changes
    .filter(
      (change) =>
        change.userId === userId &&
        !change.conflict &&
        change.effectiveDate <= date,
    )
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  for (const change of applicable)
    configuration = applyConfigurationPatch(configuration, change.patch);
  return configuration;
}

/** Emit only changed fields: a tomorrow schedule cannot overwrite an unrelated later edit. */
export function configurationDiff(
  before: Configuration,
  after: Configuration,
): ConfigurationPatch {
  const result: ConfigurationPatch = {};
  for (const key of ["blocks", "items", "lists"] as const) {
    const previous = new Map(before[key].map((entry) => [entry.id, entry]));
    const patches: { id: string; [key: string]: unknown }[] = [];
    for (const entry of after[key]) {
      const prior = previous.get(entry.id);
      if (!prior) {
        patches.push({ ...structuredClone(entry) });
        continue;
      }
      const patch: { id: string; [key: string]: unknown } = { id: entry.id };
      for (const field of new Set([
        ...Object.keys(prior),
        ...Object.keys(entry),
      ])) {
        if (field === "id") continue;
        const value = (entry as unknown as Record<string, unknown>)[field];
        if (
          JSON.stringify(value) !==
          JSON.stringify((prior as unknown as Record<string, unknown>)[field])
        ) {
          // null explicitly clears optional fields across JSON transport; undefined is dropped.
          patch[field] = value === undefined ? null : structuredClone(value);
        }
      }
      if (Object.keys(patch).length > 1) patches.push(patch);
    }
    for (const entry of before[key])
      if (!after[key].some((next) => next.id === entry.id))
        patches.push({ id: entry.id, deleted: true });
    if (patches.length) Object.assign(result, { [key]: patches });
  }
  return result;
}

export function scheduleApplies(
  schedule: Schedule | undefined | null,
  date: string,
): boolean {
  return (
    !schedule ||
    ((!schedule.startDate || date >= schedule.startDate) &&
      (!schedule.endDate || date <= schedule.endDate) &&
      (!schedule.weekdays || schedule.weekdays.includes(weekday(date))))
  );
}
export function emptyItemAnswer(item: ChecklistItem): ItemAnswer {
  return {
    generation: item.generation,
    value: null,
    selections: [],
    fields: Object.fromEntries(
      item.followups.map((field) => [
        field.id,
        structuredClone(
          field.defaultValue ??
            (field.kind === "occurrences"
              ? []
              : field.kind === "note"
                ? ""
                : null),
        ),
      ]),
    ),
  };
}
/** New compatible follow-ups gain defaults without erasing explicit clears or retained hidden fields. */
export function hydrateItemAnswer(
  item: ChecklistItem,
  answer: ItemAnswer | undefined,
): ItemAnswer {
  const defaults = emptyItemAnswer(item);
  if (!answer || answer.generation !== item.generation) return defaults;
  return {
    ...defaults,
    ...answer,
    fields: { ...defaults.fields, ...answer.fields },
    selections: answer.selections ?? [],
  };
}
/** Legacy properties are read only for the original answer schema. */
export function legacyItemAnswer(
  item: ChecklistItem,
  data: DailyData,
): ItemAnswer {
  const answer = emptyItemAnswer(item);
  if (item.generation !== 1 || !item.legacyKey) return answer;
  const raw = data as unknown as Record<string, unknown>;
  const key = item.legacyKey;
  if (key === "wake") answer.value = data.wakeTime;
  else if (key === "screenTime") answer.value = data.screenTimeMinutes;
  else if (key === "amBreakfast") answer.value = data.amBreakfast.status;
  else answer.value = (raw[`${key}Status`] as AnswerValue | undefined) ?? null;
  answer.fields.reason = (raw[`${key}Reason`] as string | undefined) ?? "";
  answer.fields.description =
    (raw[`${key}Description`] as string | undefined) ?? "";
  if (key === "amBreakfast") answer.fields.choice = data.amBreakfast.choice;
  if (key === "cannabis" || key === "applications")
    answer.fields.count = (raw[`${key}Count`] as number | null) ?? 1;
  if (key === "cannabis")
    answer.fields.occurrences = [...data.cannabisUseDescriptions];
  if (key === "schoolTasks" || key === "careerTasks")
    answer.selections = structuredClone(data[`${key}WorkedOn`]);
  return answer;
}
export function answersForConfiguration(
  configuration: Configuration,
  data: DailyData,
  custom: ItemAnswers = {},
): ItemAnswers {
  return Object.fromEntries(
    configuration.items.map((item) => {
      const key = itemAnswerKey(item.id, item.generation);
      const stored = custom[key];
      return [
        key,
        hydrateItemAnswer(
          item,
          stored?.generation === item.generation
            ? structuredClone(stored)
            : legacyItemAnswer(item, data),
        ),
      ];
    }),
  );
}
function ruleValue(answer: ItemAnswer, field: string) {
  return field === "value"
    ? answer.value
    : field === "selections"
      ? answer.selections
      : answer.fields[field];
}
function present(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== "string" || !!value.trim()) &&
    (!Array.isArray(value) || value.length > 0)
  );
}
export function evaluateRule(
  rule: Rule,
  answer: ItemAnswer,
  complete = false,
): boolean {
  switch (rule.op) {
    case "always":
      return true;
    case "never":
      return false;
    case "equals":
      return ruleValue(answer, rule.field) === rule.value;
    case "not-empty":
      return present(ruleValue(answer, rule.field));
    case "complete":
      return complete === rule.value;
    case "not":
      return !evaluateRule(rule.rule, answer, complete);
    case "all":
      return rule.rules.every((part) => evaluateRule(part, answer, complete));
    case "any":
      return rule.rules.some((part) => evaluateRule(part, answer, complete));
    case "compare": {
      const raw = ruleValue(answer, rule.field);
      // Empty inputs must not become a successful zero-valued threshold.
      if (!present(raw) || typeof raw === "boolean" || Array.isArray(raw))
        return false;
      const value =
        typeof raw === "string" && /^\d{2}:\d{2}$/.test(raw)
          ? timeMinutes(raw)
          : Number(raw);
      if (!Number.isFinite(value)) return false;
      switch (rule.operator) {
        case "lt":
          return value < rule.value;
        case "lte":
          return value <= rule.value;
        case "eq":
          return value === rule.value;
        case "gte":
          return value >= rule.value;
        case "gt":
          return value > rule.value;
      }
    }
  }
}
function requiredFollowupComplete(
  field: FollowupDefinition,
  answer: ItemAnswer,
) {
  const value = answer.fields[field.id];
  if (field.kind === "choice")
    return (
      typeof value === "string" &&
      !!field.options?.some((option) => option.id === value)
    );
  if (field.kind === "counter")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= (field.min ?? 0) &&
      value <= (field.max ?? Number.MAX_SAFE_INTEGER)
    );
  if (field.kind === "occurrences") {
    const countValue =
      field.countField === "value"
        ? answer.value
        : answer.fields[field.countField ?? "count"];
    const count = typeof countValue === "number" ? countValue : 0;
    return (
      count > 0 &&
      Array.isArray(value) &&
      value.slice(0, count).length === count &&
      value.slice(0, count).every((description) => !!description.trim())
    );
  }
  return typeof value === "string" && !!value.trim();
}
export function evaluateItem(
  item: ChecklistItem,
  answer: ItemAnswer | undefined,
  date?: string,
  context: { block?: ChecklistBlockDefinition; relevant?: boolean } = {},
): ItemEvaluation {
  const current = hydrateItemAnswer(item, answer);
  const baseComplete = evaluateRule(item.completion, current);
  const followups = item.followups.filter(
    (field) =>
      !field.condition || evaluateRule(field.condition, current, baseComplete),
  );
  const visible =
    !item.deleted &&
    !context.block?.deleted &&
    (!date || scheduleApplies(item.schedule, date)) &&
    (!date || scheduleApplies(context.block?.schedule, date)) &&
    (item.kind !== "tasks" ||
      item.visibility === "always" ||
      context.relevant !== false);
  return {
    visible,
    answer: current,
    answered: present(current.value),
    followups,
    complete:
      visible &&
      baseComplete &&
      followups
        .filter((field) => field.required)
        .every((field) => requiredFollowupComplete(field, current)),
  };
}
export function customChecklistProgress(
  configuration: Configuration,
  answers: ItemAnswers,
  date: string,
  relevance: Record<string, boolean> = {},
): CustomChecklistProgress {
  const blocks = Object.fromEntries(
    configuration.blocks.map((block) => [block.id, { completed: 0, total: 0 }]),
  );
  const byId = new Map(configuration.blocks.map((block) => [block.id, block]));
  for (const item of configuration.items) {
    const block = byId.get(item.blockId);
    if (!block) continue;
    const evaluation = evaluateItem(
      item,
      answers[itemAnswerKey(item.id, item.generation)],
      date,
      {
        block,
        relevant: relevance[item.id] ?? relevance[item.listId ?? ""] ?? false,
      },
    );
    if (!evaluation.visible) continue;
    blocks[item.blockId].total++;
    if (evaluation.complete) blocks[item.blockId].completed++;
  }
  return {
    blocks,
    completed: Object.values(blocks).reduce(
      (sum, block) => sum + block.completed,
      0,
    ),
    total: Object.values(blocks).reduce((sum, block) => sum + block.total, 0),
  };
}

export function listActivityRelevant(
  listId: string,
  answer: ItemAnswer,
  date: string,
  today: string,
  tasks: readonly Task[],
  events: readonly TaskEvent[],
  ready = true,
  mode: AppMode = PRIVATE_MODE,
): boolean {
  if (
    answer.value !== null ||
    answer.selections.length ||
    Object.values(answer.fields).some((value) =>
      typeof value === "string"
        ? !!value.trim()
        : Array.isArray(value)
          ? value.length > 0
          : false,
    )
  )
    return true;
  if (!ready || date > today) return false;
  const end = new Date(
    `${addDays(date, 1)}T02:00:00${mode.demo ? "-04:00" : ""}`,
  ).getTime();
  const history = new Map<string, TaskEvent[]>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const event of retainedTaskEvents(tasks, events, mode)) {
    const list = history.get(event.taskId) ?? [];
    list.push(event);
    history.set(event.taskId, list);
  }
  for (const list of history.values()) {
    const dayEvents = list.filter(
      (event) => event.topic === listId && event.logicalDate === date,
    );
    if (
      latestTaskEvent(dayEvents, byId.get(list[0]?.taskId))?.type ===
      "completed"
    )
      return true;
  }
  return tasks.some((task) => {
    if (task.topic !== listId || task.parentId) return false;
    if (date === today) return !task.deletedAt && !task.completedAt;
    if (
      Date.parse(task.createdAt) >= end ||
      (task.deletedAt && Date.parse(task.deletedAt) < end)
    )
      return false;
    const list = history.get(task.id) ?? [];
    const beforeEnd = list.filter((event) => Date.parse(event.at) < end);
    if (beforeEnd.length)
      return latestTaskEvent(beforeEnd, task)?.type === "reopened";
    const firstTime = Math.min(...list.map((event) => Date.parse(event.at)));
    return !list.some(
      (event) =>
        Date.parse(event.at) === firstTime && event.type === "reopened",
    );
  });
}

export const defaultAnswer = emptyItemAnswer;
export const scheduleMatches = scheduleApplies;
export function itemLabel(item: ChecklistItem, answer: ItemAnswer): string {
  for (const field of item.followups) {
    if (
      !field.displayChoiceLabel ||
      (field.condition && !evaluateRule(field.condition, answer))
    )
      continue;
    const selected = field.options?.find(
      (option) => option.id === answer.fields[field.id],
    );
    if (selected) return selected.label;
  }
  return item.label;
}
/** Preserve hidden details; only explicitly configured follow-ups reset when the main answer changes. */
export function changeItemValue(
  item: ChecklistItem,
  answer: ItemAnswer,
  value: AnswerValue,
): ItemAnswer {
  const next = {
    ...answer,
    generation: item.generation,
    value,
    fields: { ...answer.fields },
    selections: structuredClone(answer.selections),
  };
  for (const field of item.followups) {
    if (field.resetOnAnswer)
      next.fields[field.id] = structuredClone(field.defaultValue ?? null);
    if (
      field.kind === "counter" &&
      (!field.condition || evaluateRule(field.condition, next)) &&
      (next.fields[field.id] === null || next.fields[field.id] === undefined)
    ) {
      next.fields[field.id] = field.defaultValue ?? field.min ?? 0;
    }
  }
  return next;
}

export function validateConfiguration(configuration: Configuration): string[] {
  const errors: string[] = [];
  const withinText = (value: unknown, limit: number, required = false) =>
    typeof value === "string" &&
    value.length <= limit &&
    (!required || !!value.trim());
  const hasOnlyKeys = (value: object, keys: string[]) =>
    Object.keys(value).every((key) => keys.includes(key));
  if (
    configuration.blocks.length > 200 ||
    configuration.lists.length > 200 ||
    configuration.items.length > 2000
  )
    errors.push(
      "Configuration limit exceeded: use at most 200 blocks, 200 lists, and 2,000 items.",
    );
  // Pretty JSON is a conservative bound for Postgres' spaced JSON representation.
  if (JSON.stringify(configuration, null, 1).length > 1000000)
    errors.push("Configuration is too large to synchronize.");
  const validId = (value: unknown) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    /^[A-Za-z0-9:_-]+$/.test(value);
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const checkSchedule = (
    schedule: Schedule | undefined | null,
    label: string,
  ) => {
    if (!schedule) return;
    if (schedule.startDate && !validDate(schedule.startDate))
      errors.push(`${label}: invalid start date.`);
    if (schedule.endDate && !validDate(schedule.endDate))
      errors.push(`${label}: invalid end date.`);
    if (
      schedule.startDate &&
      schedule.endDate &&
      schedule.startDate > schedule.endDate
    )
      errors.push(`${label}: end date precedes start date.`);
    if (
      schedule.weekdays &&
      (new Set(schedule.weekdays).size !== schedule.weekdays.length ||
        schedule.weekdays.some(
          (day) => !Number.isInteger(day) || day < 0 || day > 6,
        ))
    )
      errors.push(`${label}: invalid weekdays.`);
  };
  for (const key of ["blocks", "items", "lists"] as const) {
    const seen = new Set<string>();
    for (const entity of configuration[key]) {
      if (!validId(entity.id) || seen.has(entity.id))
        errors.push(`${key}: invalid or duplicate ID ${entity.id}.`);
      seen.add(entity.id);
      if (!Number.isFinite(entity.order))
        errors.push(`${key}: invalid order for ${entity.id}.`);
      else if (Math.abs(entity.order) > 1000000)
        errors.push(`${key}: order must be between -1,000,000 and 1,000,000.`);
      if (entity.deleted != null && typeof entity.deleted !== "boolean")
        errors.push(`${key}: invalid archive setting.`);
    }
  }
  for (const block of configuration.blocks) {
    if (!withinText(block.title, 500, true))
      errors.push(`Block ${block.id}: title must contain 1–500 characters.`);
    if (!withinText(block.icon, 100))
      errors.push(`Block ${block.id}: invalid icon.`);
    checkSchedule(block.schedule, `Block ${block.id}`);
  }
  for (const list of configuration.lists) {
    if (!withinText(list.title, 500, true))
      errors.push(`List ${list.id}: title must contain 1–500 characters.`);
    if (!withinText(list.icon, 100))
      errors.push(`List ${list.id}: invalid icon.`);
  }
  const links = new Set<string>();
  const kinds: ItemKind[] = [
    "checkbox",
    "boolean",
    "number",
    "time",
    "duration",
    "text",
    "choice",
    "tasks",
  ];
  for (const item of configuration.items) {
    const label = `Item ${item.id}`;
    if (!withinText(item.label, 500, true))
      errors.push(`${label}: label must contain 1–500 characters.`);
    if (!kinds.includes(item.kind))
      errors.push(`${label}: unknown input type.`);
    if (
      !Number.isSafeInteger(item.generation) ||
      item.generation < 1 ||
      item.generation > 1000000
    )
      errors.push(`${label}: invalid answer generation.`);
    if (item.helper != null && !withinText(item.helper, 10000))
      errors.push(`${label}: helper text must be at most 10,000 characters.`);
    if (item.inputId != null && !withinText(item.inputId, 160))
      errors.push(`${label}: invalid input ID.`);
    if (item.legacyKey != null && !withinText(item.legacyKey, 100))
      errors.push(`${label}: invalid legacy key.`);
    if (
      item.visibility != null &&
      !["relevant", "always"].includes(item.visibility)
    )
      errors.push(`${label}: invalid visibility.`);
    if (!configuration.blocks.some((block) => block.id === item.blockId))
      errors.push(`${label}: block does not exist.`);
    checkSchedule(item.schedule, label);
    if (
      item.min !== undefined &&
      item.min !== null &&
      (!Number.isFinite(item.min) || Math.abs(item.min) > 1000000000)
    )
      errors.push(`${label}: invalid minimum.`);
    if (
      item.max !== undefined &&
      item.max !== null &&
      (!Number.isFinite(item.max) || Math.abs(item.max) > 1000000000)
    )
      errors.push(`${label}: invalid maximum.`);
    if (item.min != null && item.max != null && item.min > item.max)
      errors.push(`${label}: maximum is below minimum.`);
    if (
      item.step != null &&
      (!Number.isFinite(item.step) || item.step <= 0 || item.step > 1000000000)
    )
      errors.push(`${label}: step must be positive.`);
    const checkOptions = (options: ChecklistItem["options"], name: string) => {
      if (
        !options?.length ||
        options.length > 100 ||
        options.some(
          (option) =>
            !validId(option.id) ||
            !withinText(option.label, 500, true) ||
            !hasOnlyKeys(option, ["id", "label"]),
        ) ||
        new Set(options.map((option) => option.id)).size !== options.length
      )
        errors.push(`${name}: choices need unique IDs and labels.`);
    };
    if (item.kind === "choice") checkOptions(item.options, label);
    if (item.kind === "tasks" && !item.deleted) {
      if (
        !item.listId ||
        !configuration.lists.some((list) => list.id === item.listId)
      )
        errors.push(`${label}: choose a To-do list.`);
      else if (links.has(item.listId))
        errors.push(`${label}: this To-do list already has a linked question.`);
      else links.add(item.listId);
    } else if (item.listId && item.kind !== "tasks")
      errors.push(`${label}: only task inputs can link a list.`);
    const followups = new Map(item.followups.map((field) => [field.id, field]));
    if (item.followups.length > 50)
      errors.push(`${label}: use at most 50 follow-ups.`);
    if (followups.size !== item.followups.length)
      errors.push(`${label}: follow-up IDs must be unique.`);
    for (const field of item.followups) {
      if (
        !validId(field.id) ||
        field.id === "value" ||
        field.id === "selections" ||
        !withinText(field.label, 500, true)
      )
        errors.push(`${label}: invalid follow-up ID or label.`);
      if (!["note", "counter", "choice", "occurrences"].includes(field.kind))
        errors.push(`${label}: invalid follow-up type.`);
      for (const key of [
        "ariaLabel",
        "preferenceKey",
        "addLabel",
        "viewLabel",
        "placeholder",
      ] as const) {
        if (field[key] !== undefined && !withinText(field[key], 1000))
          errors.push(
            `${label}: ${key} must be text of at most 1,000 characters.`,
          );
      }
      for (const key of [
        "required",
        "initiallyExpanded",
        "displayChoiceLabel",
        "resetOnAnswer",
      ] as const) {
        if (field[key] !== undefined && typeof field[key] !== "boolean")
          errors.push(`${label}: invalid ${key} setting.`);
      }
      for (const key of ["min", "max"] as const) {
        if (
          field[key] !== undefined &&
          (typeof field[key] !== "number" || !Number.isFinite(field[key]))
        )
          errors.push(`${label}: invalid follow-up ${key}.`);
      }
      if (field.countField !== undefined && !validId(field.countField))
        errors.push(`${label}: invalid count field.`);
      if (field.kind === "choice")
        checkOptions(field.options, `${label}, ${field.label}`);
      if (
        field.kind === "counter" &&
        ((field.min != null &&
          (!Number.isSafeInteger(field.min) || field.min < 0)) ||
          (field.max != null &&
            (!Number.isSafeInteger(field.max) || field.max < (field.min ?? 0))))
      )
        errors.push(`${label}: invalid counter range.`);
      if (
        field.kind === "occurrences" &&
        !(field.countField === "value" && item.kind === "number") &&
        followups.get(field.countField ?? "count")?.kind !== "counter"
      )
        errors.push(`${label}: occurrence notes need a counter.`);
      if (field.defaultValue != null) {
        const value = field.defaultValue;
        const validDefault =
          field.kind === "note"
            ? typeof value === "string"
            : field.kind === "counter"
              ? typeof value === "number" &&
                Number.isSafeInteger(value) &&
                value >= (field.min ?? 0) &&
                value <= (field.max ?? 2147483647)
              : field.kind === "choice"
                ? typeof value === "string" &&
                  !!field.options?.some((option) => option.id === value)
                : Array.isArray(value) &&
                  value.length <= 10000 &&
                  value.every((entry) => typeof entry === "string");
        if (!validDefault)
          errors.push(`${label}: default value does not match ${field.label}.`);
      }
    }
    const checkRule = (rule: Rule, completion: boolean, depth = 0) => {
      if (
        !rule ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        depth > 8
      ) {
        errors.push(`${label}: rule is missing or too deeply nested.`);
        return;
      }
      if (rule.op === "all" || rule.op === "any") {
        if (
          !hasOnlyKeys(rule, ["op", "rules"]) ||
          !Array.isArray(rule.rules) ||
          !rule.rules.length ||
          rule.rules.length > 50
        )
          errors.push(`${label}: combined rule needs a condition.`);
        else
          rule.rules.forEach((part) => checkRule(part, completion, depth + 1));
      } else if (rule.op === "not") {
        if (!hasOnlyKeys(rule, ["op", "rule"]))
          errors.push(`${label}: invalid condition properties.`);
        checkRule(rule.rule, completion, depth + 1);
      } else if (rule.op === "complete") {
        if (
          !hasOnlyKeys(rule, ["op", "value"]) ||
          typeof rule.value !== "boolean"
        )
          errors.push(`${label}: invalid completion condition.`);
        if (completion)
          errors.push(`${label}: completion cannot depend on itself.`);
      } else if (
        rule.op === "equals" ||
        rule.op === "not-empty" ||
        rule.op === "compare"
      ) {
        const keys =
          rule.op === "compare"
            ? ["op", "field", "operator", "value"]
            : rule.op === "equals"
              ? ["op", "field", "value"]
              : ["op", "field"];
        if (!hasOnlyKeys(rule, keys) || !validId(rule.field))
          errors.push(`${label}: invalid condition properties.`);
        if (
          rule.op === "equals" &&
          !(
            rule.value === null ||
            typeof rule.value === "boolean" ||
            typeof rule.value === "string" ||
            (typeof rule.value === "number" && Number.isFinite(rule.value))
          )
        )
          errors.push(`${label}: invalid equality value.`);
        if (
          rule.field !== "value" &&
          rule.field !== "selections" &&
          !followups.has(rule.field)
        )
          errors.push(`${label}: condition references an unknown field.`);
        if (
          rule.op === "compare" &&
          (!Number.isFinite(rule.value) ||
            !["lt", "lte", "eq", "gte", "gt"].includes(rule.operator))
        )
          errors.push(`${label}: invalid threshold.`);
      } else if (rule.op !== "always" && rule.op !== "never")
        errors.push(`${label}: unknown completion condition.`);
      else if (!hasOnlyKeys(rule, ["op"]))
        errors.push(`${label}: invalid condition properties.`);
    };
    checkRule(item.completion, true);
    for (const field of item.followups)
      if (field.condition) checkRule(field.condition, false);
  }
  return errors;
}

export function validateItemAnswer(
  item: ChecklistItem,
  answer: ItemAnswer,
): string[] {
  const errors: string[] = [];
  if (answer.generation !== item.generation)
    return ["The answer belongs to a different input generation."];
  const value = answer.value;
  if (value !== null) {
    if (
      ["checkbox", "boolean", "tasks"].includes(item.kind) &&
      typeof value !== "boolean"
    )
      errors.push("Choose Yes or No.");
    if (["number", "duration"].includes(item.kind)) {
      if (typeof value !== "number" || !Number.isFinite(value))
        errors.push("Enter a valid number.");
      else if (
        (item.min != null && value < item.min) ||
        (item.max != null && value > item.max) ||
        (item.kind === "duration" && (value < 0 || !Number.isInteger(value)))
      )
        errors.push("The number is outside the allowed range.");
    }
    if (
      item.kind === "time" &&
      (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    )
      errors.push("Enter a valid time.");
    if (item.kind === "text" && typeof value !== "string")
      errors.push("Enter text.");
    if (
      item.kind === "choice" &&
      (typeof value !== "string" ||
        !item.options?.some((option) => option.id === value))
    )
      errors.push("Choose an available option.");
  }
  for (const field of item.followups) {
    const entry = answer.fields[field.id];
    if (entry === undefined || entry === null) continue;
    if (field.kind === "note" && typeof entry !== "string")
      errors.push(`${field.label}: enter text.`);
    if (
      field.kind === "occurrences" &&
      (!Array.isArray(entry) || entry.some((note) => typeof note !== "string"))
    )
      errors.push(`${field.label}: enter occurrence notes.`);
    if (
      field.kind === "counter" &&
      (typeof entry !== "number" ||
        !Number.isSafeInteger(entry) ||
        entry < (field.min ?? 0) ||
        entry > (field.max ?? 2147483647))
    )
      errors.push(`${field.label}: invalid counter value.`);
    if (
      field.kind === "choice" &&
      (typeof entry !== "string" ||
        !field.options?.some((option) => option.id === entry))
    )
      errors.push(`${field.label}: choose an available option.`);
  }
  return errors;
}

/** Mirror original-schema edits for older clients without ever converting an incompatible input. */
export function legacyAnswerPatch(
  item: ChecklistItem,
  answer: ItemAnswer,
): Partial<DailyData> {
  if (item.generation !== 1 || answer.generation !== 1 || !item.legacyKey)
    return {};
  const key = item.legacyKey;
  const expected: ItemKind =
    key === "wake"
      ? "time"
      : key === "screenTime"
        ? "duration"
        : key === "schoolTasks" || key === "careerTasks"
          ? "tasks"
          : "boolean";
  if (item.kind !== expected) return {};
  const patch: Record<string, unknown> = {};
  if (key === "wake")
    patch.wakeTime = typeof answer.value === "string" ? answer.value : null;
  else if (key === "screenTime")
    patch.screenTimeMinutes =
      typeof answer.value === "number" ? answer.value : null;
  else if (key === "amBreakfast")
    patch.amBreakfast = {
      status: typeof answer.value === "boolean" ? answer.value : null,
      choice:
        answer.fields.choice === "meal" || answer.fields.choice === "shake"
          ? answer.fields.choice
          : null,
    };
  else if (
    binaryFields.some((field) => field.key === key) ||
    key === "schoolTasks" ||
    key === "careerTasks"
  ) {
    patch[`${key}Status`] =
      typeof answer.value === "boolean" ? answer.value : null;
  } else return {};
  if (typeof answer.fields.reason === "string")
    patch[`${key}Reason`] = answer.fields.reason;
  if (
    typeof answer.fields.description === "string" &&
    ["meal1", "meal2", "snack1", "snack2", "snack", "amBreakfast"].includes(key)
  )
    patch[`${key}Description`] = answer.fields.description;
  if (key === "cannabis" || key === "applications") {
    patch[`${key}Count`] =
      typeof answer.fields.count === "number" ? answer.fields.count : null;
  }
  if (key === "cannabis" && Array.isArray(answer.fields.occurrences))
    patch.cannabisUseDescriptions = [...answer.fields.occurrences];
  if (key === "schoolTasks" || key === "careerTasks")
    patch[`${key}WorkedOn`] = structuredClone(answer.selections);
  return patch as Partial<DailyData>;
}

export function validateConfigurationTransition(
  before: Configuration,
  after: Configuration,
): string[] {
  const errors = validateConfiguration(after);
  for (const item of after.items) {
    const previous = before.items.find((prior) => prior.id === item.id);
    if (!previous) continue;
    if (item.generation < previous.generation)
      errors.push(`Item ${item.id}: answer generation cannot decrease.`);
    const removedOptions = (
      original: ChecklistItem["options"],
      next: ChecklistItem["options"],
    ) =>
      !!original?.some(
        (option) => !next?.some((choice) => choice.id === option.id),
      );
    const incompatible =
      item.kind !== previous.kind ||
      ((item.kind === "tasks" || previous.kind === "tasks") &&
        item.listId !== previous.listId) ||
      (item.kind === "choice" &&
        removedOptions(previous.options, item.options)) ||
      item.followups.some((field) => {
        const original = previous.followups.find(
          (prior) => prior.id === field.id,
        );
        return (
          original &&
          (original.kind !== field.kind ||
            (field.kind === "choice" &&
              removedOptions(original.options, field.options)))
        );
      });
    if (incompatible && item.generation <= previous.generation)
      errors.push(
        `Item ${item.id}: changing input type requires a new answer generation.`,
      );
  }
  return errors;
}
