import { afterEach, it, expect, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
import {
  applyTaskCommand,
  childrenOf,
  TASK_RETENTION_MS,
  visibleRoots,
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
