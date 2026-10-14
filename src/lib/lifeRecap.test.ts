import { describe, expect, it } from "vitest";
import { DEMO_MODE } from "./appMode";
import { completedLifeTasksForDay } from "./lifeRecap";
import { applyTaskCommand, visibleRoots } from "./tasks";
import type { Task, TaskCommand, TaskEvent } from "./model";

const day = "2026-10-12";
function fixture() {
  let tasks: Task[] = [];
  const events: TaskEvent[] = [];
  let sequence = 0;
  function run(
    command: Partial<TaskCommand> & Pick<TaskCommand, "taskId" | "action">,
  ) {
    const next = applyTaskCommand(tasks, "owner", `op-${++sequence}`, {
      at: `${day}T12:00:00Z`,
      logicalDate: day,
      timezone: "America/New_York",
      ...command,
    });
    tasks = next.tasks;
    events.push(...next.events);
  }
  return {
    run,
    add: (id: string, title: string, parentId?: string) =>
      run({
        taskId: id,
        action: "create",
        topic: "life",
        title,
        parentId,
      }),
    finish: (id: string, extra: Partial<TaskCommand> = {}) =>
      run({
        taskId: id,
        action: "complete",
        completed: true,
        ...extra,
      }),
    recap: (date = day) =>
      completedLifeTasksForDay("owner", date, tasks, events),
    get tasks() {
      return tasks;
    },
    get events() {
      return events;
    },
  };
}

describe("completed Life history", () => {
  it("keeps recorded completion titles after rename, deletion and 12-hour archive", () => {
    const f = fixture();
    f.add("library", "Return library books");
    f.finish("library");
    expect(
      visibleRoots(f.tasks, Date.parse(`${day}T12:00:00Z`) + 43200000),
    ).toEqual([]);
    f.run({ taskId: "library", action: "rename", title: "Renamed task" });
    f.run({ taskId: "library", action: "delete" });
    expect(f.recap()).toEqual([
      {
        taskId: "library",
        title: "Return library books",
        completed: true,
        children: [],
      },
    ]);
  });
  it("uses the day's final transition, deduplicates rechecking and preserves earlier days", () => {
    const f = fixture();
    f.add("laundry", "Do laundry");
    f.finish("laundry");
    f.run({
      taskId: "laundry",
      action: "complete",
      completed: false,
      at: `${day}T13:00:00Z`,
    });
    expect(f.recap()).toEqual([]);
    f.finish("laundry", { at: `${day}T14:00:00Z` });
    f.finish("laundry", { at: `${day}T15:00:00Z` });
    expect(f.recap()).toHaveLength(1);
    f.run({
      taskId: "laundry",
      action: "complete",
      completed: false,
      at: "2026-10-13T14:00:00Z",
      logicalDate: "2026-10-13",
    });
    expect(f.recap()).toHaveLength(1);
    expect(f.recap("2026-10-13")).toEqual([]);
  });
  it("groups only completed children under an unfinished parent, in alphabetical order", () => {
    const f = fixture();
    f.add("parent", "Prepare for moving");
    f.add("z", "Zip up bags", "parent");
    f.add("a", "Arrange transport", "parent");
    f.add("pending", "Pack clothes", "parent");
    f.finish("z");
    f.finish("a");
    f.add("standalone", "Buy groceries");
    f.finish("standalone");
    expect(f.recap()).toEqual([
      {
        taskId: "standalone",
        title: "Buy groceries",
        completed: true,
        children: [],
      },
      {
        taskId: "parent",
        title: "Prepare for moving",
        completed: false,
        children: [
          { taskId: "a", title: "Arrange transport" },
          { taskId: "z", title: "Zip up bags" },
        ],
      },
    ]);
  });
  it("reports automatic parent completion without carrying children across days", () => {
    const f = fixture();
    f.add("parent", "Prepare for moving");
    f.add("first", "Pack books", "parent");
    f.add("second", "Pack clothes", "parent");
    f.finish("first");
    f.finish("second", {
      at: "2026-10-13T14:00:00Z",
      logicalDate: "2026-10-13",
    });
    expect(f.recap()[0]).toMatchObject({
      completed: false,
      children: [{ title: "Pack books" }],
    });
    expect(f.recap("2026-10-13")[0]).toMatchObject({
      completed: true,
      children: [{ title: "Pack clothes" }],
    });
    f.run({
      taskId: "second",
      action: "complete",
      completed: false,
      at: "2026-10-13T15:00:00Z",
      logicalDate: "2026-10-13",
    });
    expect(f.recap("2026-10-13")).toEqual([]);
    expect(f.recap()[0].completed).toBe(false);
  });
  it("uses historical parent context and falls back when the parent is unavailable", () => {
    const f = fixture();
    f.add("parent", "Original parent");
    f.add("child", "Original child", "parent");
    f.finish("child");
    f.run({ taskId: "parent", action: "rename", title: "New parent" });
    f.run({ taskId: "child", action: "rename", title: "New child" });
    expect(f.recap()[0]).toMatchObject({
      title: "Original parent",
      children: [{ title: "Original child" }],
    });
    const childEvents = f.events.filter((e) => e.parentId);
    expect(
      completedLifeTasksForDay("owner", day, [], childEvents)[0],
    ).toMatchObject({
      title: "Completed subtasks",
      completed: false,
      children: [{ title: "Original child" }],
    });
  });
  it("includes legacy timestamps on the correct demo logical day without double counting", () => {
    const f = fixture();
    f.add("legacy", "Legacy task");
    const at = "2026-10-13T01:30:00-04:00";
    const tasks = [{ ...f.tasks[0], completedAt: at, updatedAt: at }];
    const recap = completedLifeTasksForDay("owner", day, tasks, [], DEMO_MODE);
    expect(recap).toHaveLength(1);
    expect(
      completedLifeTasksForDay("owner", "2026-10-13", tasks, [], DEMO_MODE),
    ).toEqual([]);
    f.finish("legacy", { at });
    expect(
      completedLifeTasksForDay("owner", day, tasks, f.events, DEMO_MODE),
    ).toEqual(recap);
  });
  it("resolves tied demo transitions from the retained row and excludes ambiguous history", () => {
    const f = fixture();
    f.add("tie", "Tied task");
    f.finish("tie");
    f.run({ taskId: "tie", action: "complete", completed: false });
    expect(f.recap()).toEqual([]);
    f.finish("tie");
    expect(f.recap()).toHaveLength(1);
    expect(completedLifeTasksForDay("owner", day, [], f.events)).toEqual([]);
  });
  it("excludes unfinished tasks, other topics and other accounts", () => {
    const f = fixture();
    f.add("pending", "Pending errand");
    f.run({
      taskId: "school",
      action: "create",
      topic: "school",
      title: "Essay",
    });
    f.finish("school");
    f.add("other", "Other account");
    f.finish("other");
    expect(
      completedLifeTasksForDay(
        "owner",
        day,
        f.tasks.map((t) =>
          t.id === "other" ? { ...t, userId: "another" } : t,
        ),
        f.events.map((e) =>
          e.taskId === "other" ? { ...e, userId: "another" } : e,
        ),
      ),
    ).toEqual([]);
  });
});
