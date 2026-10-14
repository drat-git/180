import { afterEach, it, expect, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
import {
  applyTaskCommand,
  childrenOf,
  TASK_RETENTION_MS,
  visibleRoots,
  sortTasks,
  formatDuration,
  validateTaskOptions,
} from "./tasks";
import type { Task, TaskCommand } from "./model";
const database = new AppDatabase("180-task-tests");
const repo = new LocalRepository(database);
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all([
    database.tasks.clear(),
    database.taskEvents.clear(),
    database.entries.clear(),
    database.outbox.clear(),
  ]);
});
const now = "2026-10-09T16:00:00Z";
const root: Task = {
  id: "parent",
  userId: "owner",
  topic: "school",
  parentId: null,
  title: "Physics",
  completedAt: null,
  deletedAt: null,
  revision: 0,
  createdAt: now,
  updatedAt: now,
};
it("formats durations and rejects invalid options or child priority", () => {
  expect([45, 60, 90, 120].map(formatDuration)).toEqual([
    "45 min",
    "1 hr",
    "1 hr 30 min",
    "2 hr",
  ]);
  for (const estimatedMinutes of [0, -1, 1.5, 525601, NaN]) {
    expect(() => validateTaskOptions({ estimatedMinutes })).toThrow();
  }
  expect(() => validateTaskOptions({ estimatedMinutes: 525600 })).not.toThrow();
  expect(() => validateTaskOptions({ estimatedMinutes: null })).not.toThrow();
  expect(() => validateTaskOptions({ highPriority: true }, "parent")).toThrow(
    /top-level/,
  );
});
it("sorts unfinished priority roots first while retaining creation order and completed tasks last", () => {
  const tasks = [
    { ...root, id: "a" }, // Legacy record without metadata.
    { ...root, id: "b", highPriority: true },
    { ...root, id: "c", highPriority: true },
    { ...root, id: "d", highPriority: true, completedAt: now },
  ];
  expect(sortTasks(tasks).map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
  expect(tasks.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
});
it("patches only supplied metadata and preserves completion, history, and archive timing", async () => {
  const id = await repo.createTask("owner", "school", "Read", undefined, {
    estimatedMinutes: 45,
    highPriority: true,
  });
  await repo.completeTask("owner", id, true);
  const before = (await database.tasks.get(id))!;
  await repo.updateTaskOptions("owner", id, { estimatedMinutes: 90 });
  expect(await database.tasks.get(id)).toMatchObject({
    estimatedMinutes: 90,
    highPriority: true,
    completedAt: before.completedAt,
  });
  await repo.updateTaskOptions("owner", id, { highPriority: false });
  expect(await database.tasks.get(id)).toMatchObject({
    estimatedMinutes: 90,
    highPriority: false,
    completedAt: before.completedAt,
  });
  await repo.updateTaskOptions("owner", id, { estimatedMinutes: null });
  expect((await database.tasks.get(id))!.estimatedMinutes).toBeNull();
  expect(await database.taskEvents.count()).toBe(1);
  expect(
    visibleRoots(
      await database.tasks.toArray(),
      Date.parse(before.completedAt!) + TASK_RETENTION_MS,
    ),
  ).toHaveLength(0);
});
it("stores child durations without changing parent completion and ignores options for tombstones", async () => {
  const parent = await repo.createTask("owner", "school", "Essay");
  const child = await repo.createTask("owner", "school", "Outline", parent, {
    estimatedMinutes: 20,
  });
  await repo.completeTask("owner", child, true);
  const before = (await database.tasks.get(parent))!.completedAt;
  await repo.updateTaskOptions("owner", child, { estimatedMinutes: 30 });
  expect((await database.tasks.get(parent))!.completedAt).toBe(before);
  expect(await database.taskEvents.count()).toBe(2);
  expect(() =>
    applyTaskCommand(
      [root],
      "owner",
      "invalid",
      command("kid", "create", {
        parentId: root.id,
        topic: "school",
        title: "Child",
        highPriority: true,
      }),
    ),
  ).toThrow(/top-level/);
  await repo.deleteTask("owner", parent);
  await repo.updateTaskOptions("owner", child, { estimatedMinutes: 60 });
  expect(await database.tasks.get(child)).toMatchObject({
    estimatedMinutes: 30,
    deletedAt: expect.any(String),
  });
});
function command(
  taskId: string,
  action: TaskCommand["action"],
  extra: Partial<TaskCommand> = {},
): TaskCommand {
  return {
    taskId,
    action,
    at: now,
    logicalDate: "2026-10-09",
    timezone: "America/New_York",
    ...extra,
  };
}
it("keeps completed children visible until their parent completes and resets the group timer", () => {
  let tasks = applyTaskCommand(
    [root],
    "owner",
    "a",
    command("first", "create", {
      parentId: root.id,
      topic: "school",
      title: "Read",
    }),
  ).tasks;
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "b",
    command("second", "create", {
      parentId: root.id,
      topic: "school",
      title: "Solve",
    }),
  ).tasks;
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "c",
    command("first", "complete", { completed: true }),
  ).tasks;
  expect(
    visibleRoots(tasks, Date.parse(now) + TASK_RETENTION_MS * 2),
  ).toHaveLength(1);
  expect(childrenOf(tasks, root.id)).toHaveLength(2);
  const later = new Date(Date.parse(now) + TASK_RETENTION_MS * 2).toISOString();
  const result = applyTaskCommand(
    tasks,
    "owner",
    "d",
    command("second", "complete", { completed: true, at: later }),
  );
  expect(result.events.map((e) => e.taskId)).toEqual(["second", "parent"]);
  expect(
    visibleRoots(result.tasks, Date.parse(later) + TASK_RETENTION_MS - 1),
  ).toHaveLength(1);
  expect(
    visibleRoots(result.tasks, Date.parse(later) + TASK_RETENTION_MS),
  ).toHaveLength(0);
  tasks = applyTaskCommand(
    result.tasks,
    "owner",
    "e",
    command("second", "complete", { completed: false, at: later }),
  ).tasks;
  expect(tasks[0].completedAt).toBeNull();
  const final = new Date(Date.parse(later) + 1000).toISOString();
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "f",
    command("second", "complete", { completed: true, at: final }),
  ).tasks;
  expect(tasks[0].completedAt).toBe(final);
});
it("converts a completed standalone task to an incomplete parent and enforces one level", () => {
  let tasks: Task[] = [{ ...root, completedAt: now }];
  const result = applyTaskCommand(
    tasks,
    "owner",
    "a",
    command("child", "create", {
      parentId: root.id,
      topic: "school",
      title: "Read",
    }),
  );
  expect(result.tasks[0].completedAt).toBeNull();
  expect(result.events[0].type).toBe("reopened");
  tasks = result.tasks;
  expect(() =>
    applyTaskCommand(
      tasks,
      "owner",
      "b",
      command("grandchild", "create", {
        parentId: "child",
        topic: "school",
        title: "Nested",
      }),
    ),
  ).toThrow();
  expect(() =>
    applyTaskCommand(
      tasks,
      "owner",
      "c",
      command("wrong-topic", "create", {
        parentId: root.id,
        topic: "life",
        title: "Wrong",
      }),
    ),
  ).toThrow();
  expect(
    applyTaskCommand(
      tasks,
      "owner",
      "d",
      command(root.id, "complete", { completed: true }),
    ).tasks[0].completedAt,
  ).toBeNull();
});
it("preserves snapshots and all completion events after rename, recheck, and deletion", async () => {
  const id = await repo.createTask("owner", "school", "Original");
  await repo.patchDay("owner", "2026-10-09", {
    schoolTasksStatus: true,
    schoolTasksWorkedOn: [{ taskId: id, title: "Original", children: [] }],
  });
  await repo.completeTask("owner", id, true);
  await repo.completeTask("owner", id, false);
  await repo.completeTask("owner", id, true);
  await repo.renameTask("owner", id, "Renamed");
  await repo.deleteTask("owner", id);
  expect(
    (await repo.getDay("owner", "2026-10-09"))!.data.schoolTasksWorkedOn[0]
      .title,
  ).toBe("Original");
  expect(
    (await database.taskEvents.toArray()).map((e) => e.type).sort(),
  ).toEqual(["completed", "completed", "reopened"]);
  expect(visibleRoots(await database.tasks.toArray(), Date.now())).toHaveLength(
    0,
  );
});
it("records both parent and child completion dates at the device 2 AM boundary", async () => {
  // Fake Date without faking IndexedDB timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 1, 59, 0));
  const parent = await repo.createTask("owner", "career", "Resume");
  const child = await repo.createTask("owner", "career", "Draft", parent);
  await repo.completeTask("owner", child, true);
  const events = await database.taskEvents.toArray();
  expect(events).toHaveLength(2);
  expect(events.every((e) => e.logicalDate === "2026-10-09")).toBe(true);
  vi.setSystemTime(new Date(2026, 9, 10, 2, 1, 0));
  await repo.completeTask("owner", child, false);
  await repo.completeTask("owner", child, true);
  expect(
    (await database.taskEvents.toArray()).filter(
      (e) => e.logicalDate === "2026-10-10",
    ),
  ).toHaveLength(4);
});
it("a task write failure rolls back task, history, and queue and remains retryable", async () => {
  const id = await repo.createTask("owner", "life", "Laundry");
  await database.outbox.clear();
  const save = vi
    .spyOn(database.taskEvents, "bulkPut")
    .mockRejectedValueOnce(new Error("Quota exceeded"));
  await expect(repo.completeTask("owner", id, true)).rejects.toThrow(
    "Quota exceeded",
  );
  expect((await database.tasks.get(id))!.completedAt).toBeNull();
  expect(await database.outbox.count()).toBe(0);
  expect(repo.hasUnsaved("owner")).toBe(true);
  save.mockRestore();
  await repo.retryUnsaved("owner");
  expect((await database.tasks.get(id))!.completedAt).not.toBeNull();
  expect(await database.taskEvents.count()).toBe(1);
  expect(await database.outbox.count()).toBe(1);
  expect(repo.hasUnsaved("owner")).toBe(false);
});
it("deleting the last child returns an incomplete standalone task; deleted groups cannot resurrect", () => {
  let tasks = applyTaskCommand(
    [root],
    "owner",
    "a",
    command("child", "create", {
      parentId: root.id,
      topic: "school",
      title: "Read",
    }),
  ).tasks;
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "b",
    command("child", "complete", { completed: true }),
  ).tasks;
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "c",
    command("child", "delete"),
  ).tasks;
  expect(tasks[0].completedAt).toBeNull();
  tasks = applyTaskCommand(
    tasks,
    "owner",
    "d",
    command(root.id, "delete"),
  ).tasks;
  const result = applyTaskCommand(
    tasks,
    "owner",
    "e",
    command("stale", "create", {
      parentId: root.id,
      topic: "school",
      title: "Stale child",
    }),
  );
  expect(result.tasks).toHaveLength(2);
  expect(result.tasks.every((t) => t.deletedAt)).toBe(true);
});
