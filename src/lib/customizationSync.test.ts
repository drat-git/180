import { beforeEach as registerLegacyBeforeEach } from "vitest";
import { registerAccountProfile, legacyAccountProfile } from "./accountProfile";
registerLegacyBeforeEach(() => {
  registerAccountProfile(
    legacyAccountProfile("11111111-1111-4111-8111-111111111111"),
  );
});
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import type { Tables } from "./database.types";
import type {
  ConfigChange,
  ConfigurationPatch,
  ItemAnswer,
} from "./customizationTypes";
import type { PendingOperation, TaskChecklistLink } from "./model";
import { mergeAnswer } from "./customizationStore";
import { LocalRepository } from "./repository";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
import { pullCustomization, pushCustomization } from "./customizationSync";
import { pullTasks, pushTask } from "./taskSync";

type WireChange = Tables<"config_changes">;
type WireAnswer = Tables<"custom_answers">;
type WireTask = Tables<"tasks">;
type WireEvent = Tables<"task_events">;
const USER = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-10-15";
const AT = `${DATE}T18:00:00.000Z`;
const TASK = "22222222-2222-4222-8222-222222222222";
const link: TaskChecklistLink = {
  itemId: "schoolTasks",
  generation: 1,
  listId: "school",
  configurationRevision: 0,
};
const blank = (): ItemAnswer => ({
  generation: 1,
  value: null,
  fields: {},
  selections: [],
});
const answerKey = (date: string, item: string, generation: number) =>
  `${date}|${item}|${generation}`;
const wireAnswer = (
  value = blank(),
  item = "schoolTasks",
  date = DATE,
): WireAnswer => ({
  user_id: USER,
  logical_date: date,
  item_id: item,
  generation: value.generation,
  value: value as unknown as WireAnswer["value"],
  revision: 1,
  created_at: AT,
  updated_at: AT,
});
const change = (
  id: string,
  patch: ConfigurationPatch = { blocks: [{ id: "general", title: "My day" }] },
  sequence = 1,
): ConfigChange => ({
  id,
  operationId: id,
  userId: USER,
  effectiveDate: DATE,
  sequence,
  baseRevision: sequence - 1,
  patch,
  createdAt: AT,
  revision: sequence,
});
const changeWire = (entry: ConfigChange): WireChange => ({
  operation_id: entry.id,
  user_id: entry.userId,
  effective_date: entry.effectiveDate,
  sequence: entry.sequence,
  base_revision: entry.baseRevision,
  patch: entry.patch as unknown as WireChange["patch"],
  created_at: entry.createdAt,
  revision: entry.sequence,
});
const answerOp = (
  operationId: string,
  patch: Partial<ItemAnswer>,
): PendingOperation => ({
  operationId,
  userId: USER,
  logicalDate: DATE,
  kind: "custom-answer",
  customAnswer: { itemId: "schoolTasks", generation: 1, patch },
  createdAt: AT,
});
const taskOp = (operationId: string): PendingOperation => ({
  operationId,
  userId: USER,
  logicalDate: DATE,
  kind: "task",
  createdAt: AT,
  taskCommand: {
    action: "complete",
    taskId: TASK,
    completed: true,
    recordDaily: false,
    checklistLink: { ...link },
    at: AT,
    logicalDate: DATE,
    timezone: "America/New_York",
  },
  customTaskChange: {
    parent: { taskId: TASK, title: "Essay" },
    completed: true,
  },
});
let remoteChanges: WireChange[];
let remoteAnswers: Map<string, WireAnswer>;
let remoteTasks: WireTask[];
let remoteEvents: WireEvent[];
let receipts: Map<string, string>;
let failAfterCommit: boolean;
let ranges: [string, number, number][];
async function enqueue(op: PendingOperation) {
  op.id = await db.outbox.add(op);
  return op;
}
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.clearAllMocks();
  remoteChanges = [];
  remoteAnswers = new Map();
  remoteTasks = [];
  remoteEvents = [];
  receipts = new Map();
  failAfterCommit = false;
  ranges = [];
  mock.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      const operationId = args.p_operation_id as string;
      if (name === "apply_customization_operation") {
        const existing = remoteChanges.find(
          (row) => row.operation_id === operationId,
        );
        if (!existing) {
          if (args.p_base_revision !== remoteChanges.length)
            return {
              data: null,
              error: {
                code: "40001",
                message: "Configuration changed on another device",
                details: JSON.stringify({
                  expectedRevision: args.p_base_revision,
                  actualRevision: remoteChanges.length,
                }),
              },
            };
          remoteChanges.push({
            operation_id: operationId,
            user_id: USER,
            effective_date: args.p_effective_date as string,
            sequence: remoteChanges.length + 1,
            base_revision: args.p_base_revision as number,
            patch: args.p_patch as WireChange["patch"],
            revision: remoteChanges.length + 1,
            created_at: AT,
          });
          receipts.set(operationId, "configuration");
        }
        if (failAfterCommit) {
          failAfterCommit = false;
          throw new Error("Connection interrupted after commit");
        }
        return {
          data: {
            change: structuredClone(
              remoteChanges.find((row) => row.operation_id === operationId),
            ),
            revision: remoteChanges.length,
          },
          error: null,
        };
      }
      if (name !== "apply_custom_answer_operation")
        throw new Error(`Unexpected RPC ${name}`);
      const key = answerKey(
        args.p_logical_date as string,
        args.p_item_id as string,
        args.p_generation as number,
      );
      const current = remoteAnswers.get(key) ?? wireAnswer();
      if (!receipts.has(operationId)) {
        remoteAnswers.set(key, {
          ...current,
          value: mergeAnswer(
            current.value as unknown as ItemAnswer,
            args.p_patch as Partial<ItemAnswer>,
          ) as unknown as WireAnswer["value"],
          revision: current.revision + 1,
        });
        receipts.set(operationId, key);
      }
      if (failAfterCommit) {
        failAfterCommit = false;
        throw new Error("Connection interrupted after commit");
      }
      return { data: structuredClone(remoteAnswers.get(key)), error: null };
    },
  );
  mock.from.mockImplementation((table: string) => {
    let user = USER;
    const builder = {
      select: () => builder,
      eq: (_field: string, value: string) => {
        user = value;
        return builder;
      },
      order: () => builder,
      range: async (first: number, last: number) => {
        ranges.push([table, first, last]);
        const rows =
          table === "config_changes"
            ? remoteChanges
            : table === "tasks"
              ? remoteTasks
              : table === "task_events"
                ? remoteEvents
                : [...remoteAnswers.values()];
        return {
          data: structuredClone(
            rows.filter((row) => row.user_id === user).slice(first, last + 1),
          ),
          error: null,
        };
      },
    };
    return builder;
  });
});
afterEach(() => vi.restoreAllMocks());

it("retries a committed configuration with its original operation ID after a lost acknowledgement", async () => {
  const draft = change("10000000-0000-4000-8000-000000000001");
  await db.configurations.put(draft);
  const op = await enqueue({
    operationId: draft.id,
    userId: USER,
    logicalDate: DATE,
    kind: "configuration",
    configurationChange: draft,
    createdAt: AT,
  });
  failAfterCommit = true;
  await expect(pushCustomization(op)).rejects.toThrow("after commit");
  expect(await db.outbox.count()).toBe(1);
  await pullCustomization(USER);
  await pushCustomization(op);
  expect(remoteChanges).toHaveLength(1);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.configurations.get(draft.id)).toMatchObject({
    sequence: 1,
    revision: 1,
    patch: draft.patch,
  });
  expect(mock.rpc.mock.calls.map(([, args]) => args.p_operation_id)).toEqual([
    draft.id,
    draft.id,
  ]);
});

it("answer retries return current server fields without replaying a committed old patch", async () => {
  const op = await enqueue(
    answerOp("10000000-0000-4000-8000-000000000002", {
      value: true,
      fields: { reason: "First device" },
    }),
  );
  failAfterCommit = true;
  await expect(pushCustomization(op)).rejects.toThrow("after commit");
  const key = answerKey(DATE, "schoolTasks", 1);
  const remote = remoteAnswers.get(key)!;
  remoteAnswers.set(key, {
    ...remote,
    value: {
      ...blank(),
      value: false,
      fields: { reason: "Newer correction", description: "Other device" },
    } as unknown as WireAnswer["value"],
    revision: remote.revision + 1,
  });
  await pushCustomization(op);
  expect(await db.outbox.count()).toBe(0);
  expect(
    (await db.customAnswers.get([USER, DATE, "schoolTasks", 1]))?.value,
  ).toMatchObject({
    value: false,
    fields: { reason: "Newer correction", description: "Other device" },
  });
  expect(receipts.size).toBe(1);
});

it.each(["manual-then-task", "task-then-manual"] as const)(
  "replays pending custom answers and task contributions in queue order: %s",
  async (order) => {
    const acknowledged = await enqueue(
      answerOp("10000000-0000-4000-8000-000000000003", {
        fields: { reason: "Acknowledged" },
      }),
    );
    const manual = answerOp("10000000-0000-4000-8000-000000000004", {
      value: false,
      selections: [],
      fields: { description: "Pending manual note" },
    });
    const task = taskOp("10000000-0000-4000-8000-000000000005");
    for (const op of order === "manual-then-task"
      ? [manual, task]
      : [task, manual])
      await enqueue(op);
    await pushCustomization(acknowledged);
    const stored = (await db.customAnswers.get([USER, DATE, "schoolTasks", 1]))!
      .value;
    expect(stored.fields).toMatchObject({
      reason: "Acknowledged",
      description: "Pending manual note",
    });
    expect(stored.value).toBe(order === "manual-then-task");
    expect(stored.selections.map((selection) => selection.taskId)).toEqual(
      order === "manual-then-task" ? [TASK] : [],
    );
    expect(await db.outbox.count()).toBe(2);
  },
);

it("a remote pull retains pending task contributions while merging unrelated server fields", async () => {
  remoteAnswers.set(
    answerKey(DATE, "schoolTasks", 1),
    wireAnswer({ ...blank(), fields: { reason: "Remote reason" } }),
  );
  await enqueue(taskOp("10000000-0000-4000-8000-000000000006"));
  await pullCustomization(USER);
  expect(
    (await db.customAnswers.get([USER, DATE, "schoolTasks", 1]))?.value,
  ).toMatchObject({
    value: true,
    fields: { reason: "Remote reason" },
    selections: [
      { taskId: TASK, automatic: "10000000-0000-4000-8000-000000000006" },
    ],
  });
});

it.each(["task acknowledgement", "separate pulls"] as const)(
  "does not replay manual-then-undo answer intent twice during %s",
  async (mode) => {
    const acknowledged = taskOp("10000000-0000-4000-8000-000000000020");
    if (mode === "task acknowledgement") await enqueue(acknowledged);
    await enqueue(
      answerOp("10000000-0000-4000-8000-000000000021", {
        value: false,
        fields: { reason: "Pending explanation" },
      }),
    );
    const undo = taskOp("10000000-0000-4000-8000-000000000022");
    undo.taskCommand!.completed = false;
    undo.customTaskChange!.completed = false;
    await enqueue(undo);
    const serverAnswer = wireAnswer({
      ...blank(),
      value: true,
      fields: { reason: "Server context" },
      selections: [
        {
          taskId: TASK,
          title: "Essay",
          children: [],
          manual: false,
          automatic: acknowledged.operationId,
        },
      ],
    });
    remoteAnswers.set(answerKey(DATE, "schoolTasks", 1), serverAnswer);
    remoteTasks = [
      {
        id: TASK,
        user_id: USER,
        topic: "school",
        parent_id: null,
        title: "Essay",
        completed_at: AT,
        deleted_at: null,
        revision: 2,
        estimated_minutes: null,
        high_priority: false,
        due_date: null,
        due_at: null,
        created_at: AT,
        updated_at: AT,
      },
    ];
    remoteEvents = [
      {
        id: `${acknowledged.operationId}:${TASK}`,
        operation_id: acknowledged.operationId,
        user_id: USER,
        task_id: TASK,
        parent_id: null,
        topic: "school",
        title: "Essay",
        event_type: "completed",
        occurred_at: AT,
        logical_date: DATE,
        timezone: "America/New_York",
      },
    ];
    await db.customAnswers.put({
      userId: USER,
      logicalDate: DATE,
      itemId: "schoolTasks",
      generation: 1,
      value: { ...blank(), fields: { reason: "Pending explanation" } },
      revision: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    if (mode === "task acknowledgement") {
      mock.rpc.mockResolvedValueOnce({
        data: {
          tasks: remoteTasks,
          events: remoteEvents,
          custom_answers: [serverAnswer],
        },
        error: null,
      });
      await pushTask(USER, acknowledged);
    } else {
      await pullCustomization(USER);
      await pullTasks(USER);
    }
    const value = (await db.customAnswers.get([USER, DATE, "schoolTasks", 1]))!
      .value;
    expect(value).toMatchObject({
      value: null,
      selections: [],
      fields: { reason: "Pending explanation" },
    });
    expect((await db.tasks.get(TASK))?.completedAt).toBeNull();
    expect(await db.outbox.count()).toBe(2);
  },
);

it("marks conflicting revisions as recoverable drafts, pulls remote state, and retains dependent operations", async () => {
  remoteChanges = [
    changeWire(
      change("20000000-0000-4000-8000-000000000001", {
        blocks: [{ id: "general", title: "Other device" }],
      }),
    ),
  ];
  const draft = change("10000000-0000-4000-8000-000000000007");
  await db.configurations.put(draft);
  const op = await enqueue({
    operationId: draft.id,
    userId: USER,
    logicalDate: DATE,
    kind: "configuration",
    configurationChange: draft,
    createdAt: AT,
  });
  await enqueue(taskOp("10000000-0000-4000-8000-000000000008"));
  await enqueue(
    answerOp("10000000-0000-4000-8000-000000000009", {
      fields: { reason: "Keep draft answer" },
    }),
  );
  await expect(pushCustomization(op)).rejects.toMatchObject({ code: "40001" });
  expect(await db.outbox.count()).toBe(3);
  expect(await db.configurations.get(draft.id)).toMatchObject({
    conflict: "Configuration changed on another device",
    patch: draft.patch,
  });
  expect(
    await db.configurations.get(remoteChanges[0].operation_id),
  ).toMatchObject({
    sequence: 1,
    patch: { blocks: [{ id: "general", title: "Other device" }] },
  });
  expect(
    JSON.parse((await db.meta.get(`customization-conflict:${USER}`))!.value),
  ).toMatchObject({ operationId: draft.id, patch: draft.patch });
});

it("explicit rebase retains queue positions and captured identities while changing only the reviewed revision", async () => {
  const remote = change("20000000-0000-4000-8000-000000000002", {
    blocks: [{ id: "general", title: "Remote day" }],
  });
  const draft = {
    ...change("10000000-0000-4000-8000-000000000010"),
    conflict: "Configuration changed on another device",
  };
  await db.configurations.bulkPut([remote, draft]);
  const conflict = await enqueue({
    operationId: draft.id,
    userId: USER,
    logicalDate: DATE,
    kind: "configuration",
    configurationChange: draft,
    createdAt: AT,
  });
  const task = await enqueue(taskOp("10000000-0000-4000-8000-000000000011"));
  const answer = await enqueue(
    answerOp("10000000-0000-4000-8000-000000000012", {
      fields: { reason: "Keep me" },
    }),
  );
  const originalTask = structuredClone(task);
  const repository = new LocalRepository(db);
  await repository.rebaseConfigurationConflict(USER);
  await repository.saveConfiguration(
    USER,
    { blocks: [{ id: "general", title: "Reviewed day" }] },
    DATE,
    1,
  );
  const queued = await db.outbox.orderBy("id").toArray();
  expect(queued.map((op) => op.id)).toEqual([conflict.id, task.id, answer.id]);
  expect(queued[0]).toMatchObject({
    kind: "configuration",
    configurationChange: { baseRevision: 1, sequence: 2 },
  });
  expect(queued[1]).toEqual({
    ...originalTask,
    taskCommand: {
      ...originalTask.taskCommand!,
      checklistLink: {
        ...originalTask.taskCommand!.checklistLink!,
        configurationRevision: 2,
      },
    },
  });
  expect(queued[2]).toEqual(answer);
  expect(await db.configurations.get(draft.id)).toBeUndefined();
});

it("allows an explicitly reviewed empty rebase to accept remote state while ordinary empty saves remain no-ops", async () => {
  const repository = new LocalRepository(db);
  await repository.saveConfiguration(USER, {}, DATE, 0);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.configurations.count()).toBe(0);
  const remote = change("20000000-0000-4000-8000-000000000004", {
    blocks: [{ id: "general", title: "Accepted remote day" }],
  });
  const draft = {
    ...change("10000000-0000-4000-8000-000000000023"),
    conflict: "Configuration changed on another device",
  };
  await db.configurations.bulkPut([remote, draft]);
  const conflict = await enqueue({
    operationId: draft.id,
    userId: USER,
    logicalDate: DATE,
    kind: "configuration",
    configurationChange: draft,
    createdAt: AT,
  });
  await repository.rebaseConfigurationConflict(USER);
  await repository.saveConfiguration(USER, {}, DATE, 1);
  const queued = await db.outbox.toArray();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    id: conflict.id,
    kind: "configuration",
    configurationChange: { patch: {}, sequence: 2, baseRevision: 1 },
  });
  expect(queued[0].operationId).not.toBe(draft.operationId);
  expect(await db.configurations.get(draft.id)).toBeUndefined();
  expect(await db.configurations.get(remote.id)).toEqual(remote);
});

it.each(["task", "answer"] as const)(
  "rejects a reviewed rebase that would orphan a pending %s without changing its queue",
  async (dependentKind) => {
    const remote = change("20000000-0000-4000-8000-000000000003", {
      blocks: [{ id: "body", title: "Health" }],
    });
    const patch: ConfigurationPatch = {
      lists: [{ id: "writing", title: "Writing", icon: "book", order: 3 }],
      items: [
        {
          id: "writingWork",
          blockId: "career",
          label: "Worked on writing?",
          kind: "tasks",
          generation: 1,
          order: 3,
          listId: "writing",
          completion: { op: "equals", field: "value", value: true },
          followups: [],
        },
      ],
    };
    const draft = {
      ...change("10000000-0000-4000-8000-000000000013", patch),
      conflict: "Configuration changed on another device",
    };
    await db.configurations.bulkPut([remote, draft]);
    await enqueue({
      operationId: draft.id,
      userId: USER,
      logicalDate: DATE,
      kind: "configuration",
      configurationChange: draft,
      createdAt: AT,
    });
    const dependent =
      dependentKind === "task"
        ? taskOp("10000000-0000-4000-8000-000000000014")
        : answerOp("10000000-0000-4000-8000-000000000015", { value: true });
    if (dependent.taskCommand)
      dependent.taskCommand.checklistLink = {
        itemId: "writingWork",
        generation: 1,
        listId: "writing",
        configurationRevision: 1,
      };
    if (dependent.customAnswer) dependent.customAnswer.itemId = "writingWork";
    await enqueue(dependent);
    const originalQueue = structuredClone(
      await db.outbox.orderBy("id").toArray(),
    );
    const repository = new LocalRepository(db);
    await repository.rebaseConfigurationConflict(USER);
    const reviewedPatch =
      dependentKind === "task"
        ? patch
        : { blocks: [{ id: "general", title: "Reviewed day" }] };
    const effectiveDate = dependentKind === "task" ? "2026-10-16" : DATE;
    await expect(
      repository.saveConfiguration(USER, reviewedPatch, effectiveDate, 1),
    ).rejects.toThrow("waiting to sync");
    expect(await db.outbox.orderBy("id").toArray()).toEqual(originalQueue);
    expect(await db.configurations.get(draft.id)).toEqual(draft);
  },
);

it("loads every configuration and answer page while respecting account filters", async () => {
  for (let index = 1; index <= 501; index++)
    remoteChanges.push(
      changeWire(
        change(
          `30000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
          {},
          index,
        ),
      ),
    );
  for (let index = 0; index < 501; index++)
    remoteAnswers.set(`row-${index}`, wireAnswer(blank(), `item-${index}`));
  remoteAnswers.set("other", {
    ...wireAnswer(blank(), "other"),
    user_id: "another-account",
  });
  await pullCustomization(USER);
  expect(await db.configurations.count()).toBe(501);
  expect(await db.customAnswers.count()).toBe(501);
  expect(ranges).toEqual([
    ["config_changes", 0, 499],
    ["config_changes", 500, 999],
    ["custom_answers", 0, 499],
    ["custom_answers", 500, 999],
  ]);
  expect(
    await db.customAnswers.where("userId").equals("another-account").count(),
  ).toBe(0);
});
