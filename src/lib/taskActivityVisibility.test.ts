import { describe, expect, it } from "vitest";
import { emptyData, type DailyData, type Task, type TaskEvent } from "./model";
import { taskActivityVisibility } from "./taskActivityVisibility";
import { applyTaskCommand, visibleRoots } from "./tasks";
import { logicalDate } from "./dates";

const at = (day: number, hour = 12) =>
  new Date(2026, 9, day, hour).toISOString();
const root = (overrides: Partial<Task> = {}): Task => ({
  id: "task",
  userId: "owner",
  topic: "school",
  parentId: null,
  title: "Homework",
  completedAt: null,
  deletedAt: null,
  revision: 1,
  createdAt: at(9),
  updatedAt: at(9),
  ...overrides,
});
const event = (
  day: number,
  type: TaskEvent["type"],
  overrides: Partial<TaskEvent> = {},
): TaskEvent => ({
  id: `${day}:${type}`,
  operationId: `${day}:${type}`,
  userId: "owner",
  taskId: "task",
  parentId: null,
  topic: "school",
  title: "Homework",
  type,
  at: at(day),
  logicalDate: `2026-10-${day}`,
  timezone: "America/New_York",
  ...overrides,
});
const visible = (
  date: string,
  tasks: Task[] = [],
  events: TaskEvent[] = [],
  data = emptyData(),
  today = "2026-10-12",
  ready = true,
) => taskActivityVisibility(data, date, today, tasks, events, ready);

describe("task question applicability", () => {
  it("does not add questions to an empty past day when tasks are created later", () => {
    expect(visible("2026-10-11", [root({ createdAt: at(12) })])).toEqual({
      school: false,
      career: false,
    });
    expect(visible("2026-10-12", [root({ createdAt: at(12) })]).school).toBe(
      true,
    );
  });
  it("never uses the 12-hour carryover window to create a new day's question", () => {
    const completedAt = at(11, 23);
    const task = root({ completedAt, updatedAt: completedAt });
    expect(visibleRoots([task], Date.parse(at(12, 3)))).toHaveLength(1);
    expect(
      visible(
        "2026-10-12",
        [task],
        [event(11, "completed", { at: completedAt })],
      ).school,
    ).toBe(false);
    expect(
      visible(
        "2026-10-11",
        [task],
        [event(11, "completed", { at: completedAt })],
      ).school,
    ).toBe(true);
  });
  it("keeps unfinished days after later completion or deletion", () => {
    const task = root({ deletedAt: at(12), updatedAt: at(12) });
    expect(visible("2026-10-10", [task]).school).toBe(true);
    expect(visible("2026-10-11", [task]).school).toBe(true);
    expect(visible("2026-10-12", [task]).school).toBe(false);
    expect(
      visible(
        "2026-10-11",
        [root({ completedAt: at(12) })],
        [event(12, "completed")],
      ).school,
    ).toBe(true);
  });
  it("treats same-day creation/deletion without completion as never present", () => {
    const task = root({
      createdAt: at(11),
      deletedAt: at(11, 15),
      updatedAt: at(11, 15),
    });
    expect(visible("2026-10-11", [task]).school).toBe(false);
    expect(
      visible("2026-10-11", [task], [], emptyData(), "2026-10-11").school,
    ).toBe(false);
  });
  it("keeps today's completion after archiving or deletion, without answering Yes", () => {
    const task = root({ completedAt: at(12, 3), deletedAt: at(12, 16) });
    const data = emptyData();
    expect(
      visible(
        "2026-10-12",
        [task],
        [event(12, "completed", { at: at(12, 3) })],
        data,
      ).school,
    ).toBe(true);
    expect(data.schoolTasksStatus).toBeNull();
    expect(visible("2026-10-12", [], [event(12, "completed")]).school).toBe(
      true,
    );
  });
  it("same-day reopening cancels completion evidence, later-day reopening preserves it", () => {
    const task = root({ deletedAt: at(12, 18), updatedAt: at(12, 18) });
    expect(
      visible(
        "2026-10-12",
        [task],
        [event(12, "completed"), event(12, "reopened", { at: at(12, 17) })],
      ).school,
    ).toBe(false);
    expect(
      visible(
        "2026-10-11",
        [task],
        [event(11, "completed"), event(12, "reopened")],
      ).school,
    ).toBe(true);
  });
  it("rechecking restores completion evidence and reopening an earlier completion creates an unfinished day", () => {
    expect(
      visible(
        "2026-10-12",
        [root({ completedAt: at(12, 18) })],
        [
          event(12, "completed"),
          event(12, "reopened", { at: at(12, 17) }),
          event(12, "completed", { id: "again", at: at(12, 18) }),
        ],
      ).school,
    ).toBe(true);
    expect(
      visible(
        "2026-10-11",
        [root()],
        [event(10, "completed"), event(11, "reopened")],
      ).school,
    ).toBe(true);
  });
  it("a completed child independently qualifies after deletion of its unfinished parent", () => {
    const parent = root({ deletedAt: at(12, 17) });
    const child = root({
      id: "child",
      parentId: "task",
      completedAt: at(12),
      deletedAt: at(12, 17),
    });
    expect(
      visible(
        "2026-10-12",
        [parent, child],
        [event(12, "completed", { taskId: "child", parentId: "task" })],
      ).school,
    ).toBe(true);
  });
  it("actual automatic parent transitions qualify, and creating a child reopens the parent", () => {
    let tasks = [root(), root({ id: "child", parentId: "task" })];
    const result = applyTaskCommand(tasks, "owner", "done", {
      taskId: "child",
      action: "complete",
      completed: true,
      at: at(12),
      logicalDate: "2026-10-12",
      timezone: "America/New_York",
    });
    expect(result.events.map((e) => e.taskId)).toEqual(["child", "task"]);
    expect(visible("2026-10-12", result.tasks, result.events).school).toBe(
      true,
    );
    tasks = applyTaskCommand(result.tasks, "owner", "new-child", {
      taskId: "child2",
      action: "create",
      title: "More",
      topic: "school",
      parentId: "task",
      at: at(12, 16),
      logicalDate: "2026-10-12",
      timezone: "America/New_York",
    }).tasks;
    expect(visible("2026-10-12", tasks, result.events).school).toBe(true);
  });
  it.each([true, false, "reason", "selections"] as const)(
    "preserves saved %s with no remaining tasks",
    (saved) => {
      const data = emptyData();
      if (typeof saved === "boolean") data.schoolTasksStatus = saved;
      else if (saved === "reason") data.schoolTasksReason = "Saved reason";
      else
        data.schoolTasksWorkedOn = [
          {
            taskId: "task",
            title: "Old title",
            children: [{ taskId: "child", title: "Old child" }],
          },
        ];
      const before = structuredClone(data);
      expect(visible("2026-10-09", [], [], data).school).toBe(true);
      expect(data).toEqual(before);
    },
  );
  it("ignores retired eligibility flags and segregates School, Career, and Life", () => {
    const data = {
      ...emptyData(),
      schoolTasksEligible: true,
      careerTasksEligible: true,
    } as DailyData;
    expect(visible("2026-10-12", [], [], data)).toEqual({
      school: false,
      career: false,
    });
    expect(
      visible("2026-10-12", [
        root({ topic: "career" }),
        root({ topic: "life" }),
      ]),
    ).toEqual({ school: false, career: true });
  });
  it("waits for coherent task/history loading while still preserving saved content", () => {
    expect(
      visible("2026-10-12", [root()], [], emptyData(), "2026-10-12", false)
        .school,
    ).toBe(false);
    const data = emptyData();
    data.schoolTasksStatus = false;
    expect(
      visible("2026-10-12", [], [], data, "2026-10-12", false).school,
    ).toBe(true);
  });
  it("uses the local 2 AM boundary, including completion just before rollover", () => {
    const completedAt = at(12, 1);
    expect(logicalDate(new Date(completedAt))).toBe("2026-10-11");
    const task = root({ completedAt, updatedAt: completedAt });
    expect(
      visible(
        "2026-10-11",
        [task],
        [event(11, "completed", { at: completedAt })],
      ).school,
    ).toBe(true);
    expect(
      visible(
        "2026-10-12",
        [task],
        [event(11, "completed", { at: completedAt })],
      ).school,
    ).toBe(false);
    expect(visible("2026-10-11", [root({ createdAt: at(12, 2) })]).school).toBe(
      false,
    );
    expect(visible("2026-10-11", [root({ deletedAt: at(12, 2) })]).school).toBe(
      true,
    );
  });
  it("handles the DST day boundary using calendar days rather than 24 elapsed hours", () => {
    const task = root({
      createdAt: new Date(2026, 10, 1, 1, 45).toISOString(),
      deletedAt: new Date(2026, 10, 1, 3).toISOString(),
    });
    expect(
      visible("2026-10-31", [task], [], emptyData(), "2026-11-02").school,
    ).toBe(true);
    expect(
      visible("2026-11-01", [task], [], emptyData(), "2026-11-02").school,
    ).toBe(false);
  });
  it("uses known row completions, but does not invent unanswered questions from incomplete legacy history", () => {
    expect(visible("2026-10-12", [root({ completedAt: at(12) })]).school).toBe(
      true,
    );
    expect(visible("2026-10-11", [root({ completedAt: at(10) })]).school).toBe(
      false,
    );
    expect(
      visible("2026-10-11", [root()], [event(12, "reopened")]).school,
    ).toBe(false);
  });
  it("resolves equal-timestamp current transitions from the final row and avoids guessing old ambiguous transitions", () => {
    const events = [event(11, "completed"), event(11, "reopened")];
    expect(
      visible(
        "2026-10-11",
        [root({ updatedAt: at(11), deletedAt: at(11, 17) })],
        events,
      ).school,
    ).toBe(false);
    expect(
      visible("2026-10-11", [root({ updatedAt: at(12) })], events).school,
    ).toBe(false);
  });
});
