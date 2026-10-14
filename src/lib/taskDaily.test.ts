import { afterEach, expect, it, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
import { emptyData, type TaskDailyChange, type TaskSelection } from "./model";
import { mergeTaskSelections, replayDaily, taskDailyPatch } from "./taskDaily";
import { DEMO_NOW, DEMO_TODAY } from "./appMode";

const change: TaskDailyChange = {
  topic: "school",
  parent: { taskId: "parent", title: "Essay" },
  child: { taskId: "child", title: "Outline" },
  completed: true,
};
const undo = { ...change, completed: false };
const manual: TaskSelection = { ...change.parent, children: [] };
it("merges immediate child work once, with snapshots and no implicit siblings", () => {
  const first = mergeTaskSelections([], change, "a");
  expect(first).toEqual([
    {
      ...change.parent,
      manual: false,
      children: [{ ...change.child, manual: false, automatic: "a" }],
    },
  ]);
  expect(mergeTaskSelections(first, change, "a")).toEqual(first);
  expect(mergeTaskSelections(first, undo, "b")).toEqual([]);
  expect(first[0].children).toHaveLength(1); // Does not mutate its input.
});
it("preserves a legacy manual parent when undoing its automatic child", () => {
  const first = mergeTaskSelections([manual], change, "a");
  expect(mergeTaskSelections(first, undo, "b")).toEqual([manual]);
});
it("preserves an automatic parent container with an independently manual child", () => {
  const first = mergeTaskSelections([], change, "a");
  first[0].children.push({
    taskId: "manual-child",
    title: "Research",
    manual: true,
  });
  const result = mergeTaskSelections(first, undo, "b");
  expect(result[0].manual).toBe(false);
  expect(result[0].children).toEqual([
    { taskId: "manual-child", title: "Research", manual: true },
  ]);
});
it("retains a legacy manual child when its automatic contribution is undone", () => {
  const source = [
    { ...manual, manual: false, children: [{ ...change.child! }] },
  ];
  expect(
    mergeTaskSelections(mergeTaskSelections(source, change, "a"), undo, "b"),
  ).toEqual(source);
});
it("resets empty automatic work to unanswered, retains other work, and preserves unrelated answers", () => {
  const data = {
    ...emptyData(),
    schoolTasksReason: "Busy",
    journalText: "Keep",
  };
  const completed = { ...data, ...taskDailyPatch(data, change, "a") };
  expect(completed.schoolTasksStatus).toBe(true);
  expect(completed.schoolTasksReason).toBe("Busy");
  const patch = taskDailyPatch(completed, undo, "b");
  expect(patch).toEqual({ schoolTasksStatus: null, schoolTasksWorkedOn: [] });
  completed.schoolTasksWorkedOn.push({
    taskId: "other",
    title: "Read",
    children: [],
  });
  expect(taskDailyPatch(completed, undo, "b").schoolTasksStatus).toBe(true);
  expect(taskDailyPatch(data, undo, "b")).toEqual({});
});
it("replays automatic effects and manual removals in outbox order", () => {
  const base = { userId: "owner", logicalDate: "2026-10-09", createdAt: "now" };
  const auto = {
    ...base,
    kind: "task" as const,
    operationId: "a",
    taskDailyChange: change,
  };
  const manual = {
    ...base,
    kind: "entry" as const,
    operationId: "b",
    patch: { schoolTasksWorkedOn: [], schoolTasksStatus: null },
  };
  expect(replayDaily(emptyData(), [auto, manual]).schoolTasksWorkedOn).toEqual(
    [],
  );
  expect(replayDaily(emptyData(), [manual, auto]).schoolTasksStatus).toBe(true);
});

const database = new AppDatabase("180-task-daily-tests");
let repo = new LocalRepository(database);
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all([
    database.tasks.clear(),
    database.taskEvents.clear(),
    database.entries.clear(),
    database.outbox.clear(),
  ]);
  repo = new LocalRepository(database);
});
function clock(date = new Date(2026, 9, 10, 1, 59)) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
}
it.each(["school", "career"] as const)(
  "records %s work atomically on the actual logical day, preserving reasons",
  async (topic) => {
    clock();
    const id = await repo.createTask("owner", topic, "Read");
    await repo.patchDay("owner", "2026-10-09", {
      [`${topic}TasksStatus`]: false,
      [`${topic}TasksReason`]: "Keep",
    });
    await repo.patchDay("owner", "2026-10-08", {
      journalText: "Historical open day",
    });
    await repo.completeTask("owner", id, true);
    const data = (await repo.getDay("owner", "2026-10-09"))!.data;
    expect(data[`${topic}TasksStatus`]).toBe(true);
    expect(data[`${topic}TasksReason`]).toBe("Keep");
    expect(data[`${topic}TasksWorkedOn`][0]).toMatchObject({
      taskId: id,
      title: "Read",
      manual: false,
    });
    expect((await repo.getDay("owner", "2026-10-08"))!.data.journalText).toBe(
      "Historical open day",
    );
  },
);
it("final-child completion selects only that day's children; later undo never rewrites yesterday", async () => {
  clock();
  const parent = await repo.createTask("owner", "school", "Essay");
  const a = await repo.createTask("owner", "school", "Outline", parent);
  const b = await repo.createTask("owner", "school", "Write", parent);
  await repo.completeTask("owner", a, true);
  const yesterday = (await repo.getDay("owner", "2026-10-09"))!.data;
  expect((await database.tasks.get(parent))!.completedAt).toBeNull();
  vi.setSystemTime(new Date(2026, 9, 10, 2, 1));
  await repo.completeTask("owner", b, true);
  const today = (await repo.getDay("owner", "2026-10-10"))!.data;
  expect(today.schoolTasksWorkedOn).toHaveLength(1);
  expect(today.schoolTasksWorkedOn[0].children.map((c) => c.taskId)).toEqual([
    b,
  ]);
  await repo.completeTask("owner", a, false);
  expect((await repo.getDay("owner", "2026-10-09"))!.data).toEqual(yesterday);
  await repo.completeTask("owner", b, false);
  expect(
    (await repo.getDay("owner", "2026-10-10"))!.data.schoolTasksStatus,
  ).toBeNull();
  await repo.completeTask("owner", b, true);
  const timestamp = (await database.tasks.get(b))!.completedAt;
  await repo.completeTask("owner", b, true); // No transition, no work duplication/timer reset.
  expect((await database.tasks.get(b))!.completedAt).toBe(timestamp);
  expect(
    (await repo.getDay("owner", "2026-10-10"))!.data.schoolTasksWorkedOn[0]
      .children,
  ).toHaveLength(1);
});
it("deletion-induced parent completion, creation, options, rename and Life create no daily work", async () => {
  clock();
  const p = await repo.createTask("owner", "school", "Essay");
  const a = await repo.createTask("owner", "school", "Old", p);
  const b = await repo.createTask("owner", "school", "Delete", p);
  await repo.completeTask("owner", a, true);
  vi.setSystemTime(new Date(2026, 9, 10, 3));
  await repo.deleteTask("owner", b);
  expect((await database.tasks.get(p))!.completedAt).not.toBeNull();
  await repo.renameTask("owner", p, "New title");
  await repo.updateTaskOptions("owner", p, { highPriority: true });
  const life = await repo.createTask("owner", "life", "Laundry");
  await repo.completeTask("owner", life, true);
  expect(await repo.getDay("owner", "2026-10-10")).toBeUndefined();
  const saved = (await repo.getDay("owner", "2026-10-09"))!.data
    .schoolTasksWorkedOn[0];
  await repo.deleteTask("owner", p);
  expect(saved.title).toBe("Essay");
  expect(saved.children[0].title).toBe("Old");
  expect(
    (await repo.getDay("owner", "2026-10-09"))!.data.schoolTasksWorkedOn[0],
  ).toEqual(saved);
});
it("rolls back daily/task/history/outbox together and retries failed completion before later manual edits", async () => {
  clock();
  const id = await repo.createTask("owner", "school", "Read");
  await database.outbox.clear();
  const put = vi
    .spyOn(database.entries, "put")
    .mockRejectedValueOnce(new Error("Disk full"));
  await expect(repo.completeTask("owner", id, true)).rejects.toThrow(
    "Disk full",
  );
  expect((await database.tasks.get(id))!.completedAt).toBeNull();
  expect(await database.taskEvents.count()).toBe(0);
  expect(await database.outbox.count()).toBe(0);
  put.mockRestore();
  vi.setSystemTime(new Date(2026, 9, 10, 2, 1)); // Recovery keeps the original operation day.
  await repo.patchDay("owner", "2026-10-09", {
    schoolTasksStatus: null,
    schoolTasksWorkedOn: [],
  });
  expect((await database.tasks.get(id))!.completedAt).not.toBeNull();
  expect(
    (await repo.getDay("owner", "2026-10-09"))!.data.schoolTasksStatus,
  ).toBeNull();
  expect((await database.outbox.toArray()).map((op) => op.kind)).toEqual([
    "task",
    "entry",
  ]);
  const reloaded = new LocalRepository(database);
  expect(reloaded.hasUnsaved("owner")).toBe(false);
  expect(
    (await reloaded.getDay("owner", "2026-10-09"))!.data.schoolTasksWorkedOn,
  ).toEqual([]);
});
it("uses the frozen demo clock and never writes demo work to the private account/outbox", async () => {
  clock(new Date("2026-11-01T10:00:00Z"));
  const id = await repo.createTask("local-demo:test", "career", "Practice");
  await repo.completeTask("local-demo:test", id, true);
  const entry = (await repo.getDay("local-demo:test", DEMO_TODAY))!;
  expect(entry.updatedAt).toBe(new Date(DEMO_NOW).toISOString());
  expect(entry.data.careerTasksStatus).toBe(true);
  expect(await database.entries.where("userId").equals("owner").count()).toBe(
    0,
  );
  expect(await database.outbox.count()).toBe(0);
});
