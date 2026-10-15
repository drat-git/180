import { describe, expect, it } from "vitest";
import { DEMO_MODE, DEMO_TODAY, PRIVATE_MODE } from "./appMode";
import {
  calendarDaySummary,
  calendarDueTasks,
  completionBand,
  completionPercent,
  monthDates,
  shiftMonth,
  type CalendarSnapshot,
} from "./calendar";
import { createDemoSeed } from "./demo";
import { applyAntiCommand } from "./antiRotting";
import { emptyData, type Task, type TaskEvent } from "./model";

const userId = "local-demo:calendar-tests";
function snapshot(): CalendarSnapshot {
  const seed = createDemoSeed(userId);
  return {
    entries: seed.entries,
    tasks: seed.tasks,
    events: seed.taskEvents,
    images: [],
    antiLogs: seed.logs,
    antiEvents: seed.events,
  };
}
const summary = (data: CalendarSnapshot, date = "2026-10-12") =>
  calendarDaySummary(data, userId, date, DEMO_TODAY, DEMO_MODE);

it("groups only the owner's unfinished root deadlines by their local calendar date and task ordering", () => {
  const task = (id: string, options: Partial<Task> = {}): Task => ({
    id,
    userId,
    topic: "life",
    parentId: null,
    title: id,
    completedAt: null,
    deletedAt: null,
    revision: 1,
    createdAt: "2026-10-13T12:00:00Z",
    updatedAt: "2026-10-13T12:00:00Z",
    deadline: { date: "2026-11-01" },
    ...options,
  });
  const rows = [
    task("date-only"),
    task("timed", { deadline: { at: "2026-11-02T00:00:00.000Z" } }),
    task("priority", { highPriority: true }),
    task("completed", { completedAt: "2026-10-13T13:00:00Z" }),
    task("deleted", { deletedAt: "2026-10-13T13:00:00Z" }),
    task("subtask", { parentId: "priority" }),
    task("other-account", { userId: "someone-else" }),
    task("undated", { deadline: null }),
  ];
  const eastern = calendarDueTasks(rows, userId, "America/New_York");
  expect([...eastern.keys()]).toEqual(["2026-11-01"]);
  expect(eastern.get("2026-11-01")!.map((item) => item.id)).toEqual([
    "priority",
    "timed",
    "date-only",
  ]);
  const tokyo = calendarDueTasks(rows, userId, "Asia/Tokyo");
  expect(tokyo.get("2026-11-01")!.map((item) => item.id)).toEqual([
    "priority",
    "date-only",
  ]);
  expect(tokyo.get("2026-11-02")!.map((item) => item.id)).toEqual(["timed"]);
});

describe("calendar scoring and month geometry", () => {
  it("uses private thresholds and the historical Food/Creatine cutoffs", () => {
    const owner = "calendar-owner";
    const data: CalendarSnapshot = {
      entries: [],
      tasks: [],
      events: [],
      images: [],
      antiLogs: [],
      antiEvents: [],
    };
    for (const date of ["2026-10-11", "2026-10-12", "2026-10-13"]) {
      data.entries.push({
        userId: owner,
        logicalDate: date,
        data: {
          ...emptyData(),
          wakeTime: "09:10",
          cannabisStatus: true,
          cannabisCount: 2,
          amBreakfast: { status: true, choice: "meal" },
          creatineStatus: true,
        },
        revision: 1,
        createdAt: `${date}T12:00:00Z`,
        updatedAt: `${date}T12:00:00Z`,
      });
    }
    expect(
      data.entries.map((entry) => {
        const day = calendarDaySummary(
          data,
          owner,
          entry.logicalDate,
          "2026-10-14",
          PRIVATE_MODE,
        );
        return { completed: day.completed, total: day.total };
      }),
    ).toEqual([
      { completed: 2, total: 12 },
      { completed: 3, total: 13 },
      { completed: 4, total: 14 },
    ]);
  });
  it.each([
    [0, 100, 0],
    [1, 100, 1],
    [24, 100, 1],
    [25, 100, 2],
    [49, 100, 2],
    [50, 100, 3],
    [74, 100, 3],
    [75, 100, 4],
    [99, 100, 4],
    [100, 100, 5],
    [199, 200, 4],
    [0, 0, null],
  ])("assigns %i/%i to band %s without rounding", (complete, total, band) => {
    expect(completionBand(complete, total)).toBe(band);
  });
  it("does not display 100% for an incomplete day", () => {
    expect(completionPercent(199, 200)).toBe(99);
    expect(completionPercent(200, 200)).toBe(100);
    expect(completionPercent(0, 0)).toBe(0);
  });
  it("lays out complete Sunday-first weeks across leap and year boundaries", () => {
    expect(monthDates("2028-02")).toContain("2028-02-29");
    expect(monthDates("2026-02")).not.toContain("2026-02-29");
    expect(monthDates("2026-02")).toHaveLength(28);
    expect(monthDates("2026-10")).toHaveLength(35);
    expect(monthDates("2026-10")[0]).toBe("2026-09-27");
    expect(monthDates("2026-10").at(-1)).toBe("2026-10-31");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
  it("matches seeded daily totals and distinguishes blank records from recorded zero", () => {
    const data = snapshot();
    expect(summary(data, "2026-10-11")).toMatchObject({
      completed: 9,
      total: 13,
      band: 3,
      blocks: { School: { total: 0 } },
    });
    expect(summary(data)).toMatchObject({ completed: 13, total: 15, band: 4 });
    expect(summary(data, DEMO_TODAY)).toMatchObject({
      completed: 0,
      total: 15,
      band: null,
      recorded: false,
    });
    data.entries[2].data.liftedStatus = false;
    expect(summary(data, DEMO_TODAY)).toMatchObject({
      completed: 0,
      band: 0,
      recorded: true,
    });
    data.entries[2].data = { ...emptyData(), cannabisStatus: false };
    expect(summary(data, DEMO_TODAY)).toMatchObject({ completed: 1, band: 1 });
  });
  it("recognizes photo-only records without counting the photo as a check", () => {
    const data = snapshot();
    data.images.push({
      id: "photo",
      userId,
      logicalDate: DEMO_TODAY,
      storagePath: "photo",
      position: 0,
      revision: 0,
      deletedAt: null,
      createdAt: "",
      updatedAt: "",
    });
    expect(summary(data, DEMO_TODAY)).toMatchObject({
      completed: 0,
      recorded: true,
      band: 0,
    });
    data.images[0].deletedAt = "2026-10-13T08:00:00-04:00";
    expect(summary(data, DEMO_TODAY).recorded).toBe(false);
  });
});

describe("calendar worked-on history", () => {
  it("includes logged and completed Anti-rot activities once on their recorded days without changing checklist totals", () => {
    const data = snapshot();
    expect(
      summary(data, "2026-10-11").antiRotting.map((activity) => activity.title),
    ).toEqual(["Read for pleasure", "Take a walk without headphones"]);
    const lecture = data.antiLogs.find((log) => log.itemType === "one-time")!;
    lecture.manual = true;
    const day = summary(data);
    expect(day.antiRotting.map((activity) => activity.title)).toEqual([
      "Watch a public lecture about space",
      "Practice guitar for 15 minutes",
    ]);
    expect(day).toMatchObject({ completed: 13, total: 15 });
    expect(summary(data, DEMO_TODAY).antiRotting).toEqual([]);
  });
  it("uses retained Anti-rot snapshots and honors same-day undo while preserving work after a later-day reopening", () => {
    const seed = createDemoSeed(userId);
    const data = snapshot();
    const lecture = seed.items.find(
      (item) => item.itemType === "one-time" && item.completedAt,
    )!;
    const reopen = (date: string) =>
      applyAntiCommand(
        { items: seed.items, logs: data.antiLogs, events: data.antiEvents },
        userId,
        "reopen-lecture",
        {
          itemId: lecture.id,
          action: "complete",
          completed: false,
          at: `${date}T23:50:00-04:00`,
          logicalDate: date,
          timezone: "America/New_York",
        },
      );
    const later = reopen(DEMO_TODAY);
    expect(
      summary({
        ...data,
        antiLogs: later.logs,
        antiEvents: later.events,
      }).antiRotting.map((item) => item.title),
    ).toContain(lecture.title);
    const sameDay = reopen("2026-10-12");
    expect(
      summary({
        ...data,
        antiLogs: sameDay.logs,
        antiEvents: sameDay.events,
      }).antiRotting.map((item) => item.title),
    ).not.toContain(lecture.title);
    data.antiLogs.find((log) => log.itemId === lecture.id)!.manual = true;
    const manual = reopen("2026-10-12");
    expect(
      summary({
        ...data,
        antiLogs: manual.logs,
        antiEvents: manual.events,
      }).antiRotting.map((item) => item.title),
    ).toContain(lecture.title);
  });
  it("combines selections and completions once, includes Life and does not carry old completions forward", () => {
    const data = snapshot();
    const day = summary(data);
    expect(day.workedOn.school.map((task) => task.title)).toEqual([
      "Finish statistics practice set",
      "Prepare history essay",
    ]);
    expect(day.workedOn.career).toHaveLength(1);
    expect(day.workedOn.career[0].children.map((child) => child.title)).toEqual(
      ["Add search and filters", "Write setup notes"],
    );
    expect(day.workedOn.life.map((task) => task.title)).toEqual([
      "Return library books",
    ]);
    expect(summary(data, DEMO_TODAY).workedOn.life).toEqual([]);
    expect(summary(data, DEMO_TODAY).completed).toBe(0);
  });
  it("preserves captured names and hierarchy after renaming and deletion", () => {
    const data = snapshot();
    for (const task of data.tasks) {
      task.title = "Renamed later";
      task.deletedAt = "2026-10-13T08:00:00-04:00";
    }
    const day = summary(data);
    expect(day.workedOn.school[1].title).toBe("Prepare history essay");
    expect(day.workedOn.school[1].children[0].title).toBe("Choose a topic");
    expect(day.workedOn.life[0].title).toBe("Return library books");
  });
  it("excludes hidden No selections but keeps independent check-off events", () => {
    const data = snapshot();
    data.entries[1].data.schoolTasksStatus = false;
    data.entries[1].data.schoolTasksWorkedOn.push({
      taskId: "manual-only",
      title: "Hidden selection",
      children: [],
    });
    const day = summary(data);
    expect(JSON.stringify(day.workedOn.school)).not.toContain(
      "Hidden selection",
    );
    expect(JSON.stringify(day.workedOn.school)).toContain(
      "Finish statistics practice set",
    );
  });
  it("a parent selection does not imply work on unselected children", () => {
    const data = snapshot();
    data.events = [];
    data.tasks = data.tasks.map((task) => ({ ...task, completedAt: null }));
    data.entries[1].data.careerTasksWorkedOn[0].children = [];
    expect(summary(data).workedOn.career[0].children).toEqual([]);
  });
  it("keeps child-only context separate from an independently worked-on parent", () => {
    const data = snapshot();
    const selection = data.entries[1].data.schoolTasksWorkedOn[1];
    selection.manual = false;
    expect(summary(data).workedOn.school[1]).toMatchObject({
      title: "Prepare history essay",
      workedOn: false,
      children: [{ title: "Choose a topic" }],
    });
  });
  it("same-day reopening removes a check-off; later reopening preserves its recorded day", () => {
    const data = snapshot();
    const completion = data.events.find((event) => event.topic === "life")!;
    const task = data.tasks.find((task) => task.id === completion.taskId)!;
    const reopening: TaskEvent = {
      ...completion,
      id: "reopen",
      operationId: "reopen",
      type: "reopened",
      at: "2026-10-12T23:00:00-04:00",
    };
    task.completedAt = null;
    task.updatedAt = reopening.at;
    data.events.push(reopening);
    expect(summary(data).workedOn.life).toEqual([]);
    reopening.at = "2026-10-13T08:00:00-04:00";
    reopening.logicalDate = DEMO_TODAY;
    task.updatedAt = reopening.at;
    expect(summary(data).workedOn.life[0].title).toBe("Return library books");
    expect(summary(data, DEMO_TODAY).workedOn.life).toEqual([]);
  });
  it("retains manual selections when their check-off was undone", () => {
    const data = snapshot();
    const completion = data.events.find(
      (event) => event.title === "Finish statistics practice set",
    )!;
    data.events.push({
      ...completion,
      id: "reopen",
      operationId: "reopen",
      type: "reopened",
      at: "2026-10-12T23:00:00-04:00",
    });
    data.tasks.find((task) => task.id === completion.taskId)!.completedAt =
      null;
    expect(summary(data).workedOn.school[0].title).toBe(
      "Finish statistics practice set",
    );
  });
  it("resolves fixed-clock check/uncheck ties from the task row", () => {
    const data = snapshot();
    const task = data.tasks.find((task) => task.topic === "life")!;
    const event: TaskEvent = {
      id: "check",
      operationId: "check",
      userId,
      taskId: task.id,
      parentId: null,
      topic: "life",
      title: task.title,
      type: "completed",
      logicalDate: DEMO_TODAY,
      timezone: "America/New_York",
      at: "2026-10-13T08:00:00-04:00",
    };
    task.updatedAt = event.at;
    task.completedAt = event.at;
    data.events.push(event, {
      ...event,
      id: "uncheck",
      operationId: "uncheck",
      type: "reopened",
    });
    expect(summary(data, DEMO_TODAY).workedOn.life).toHaveLength(1);
    task.completedAt = null;
    expect(summary(data, DEMO_TODAY).workedOn.life).toHaveLength(0);
  });
  it("does not mix another account's entries, task history or photos into the summary", () => {
    const data = snapshot();
    const other = snapshot();
    data.entries.unshift(
      ...other.entries.map((entry) => ({
        ...entry,
        userId: "owner",
        data: { ...entry.data, journalText: "Private journal" },
      })),
    );
    data.events.push(
      ...other.events.map((event) => ({
        ...event,
        userId: "owner",
        title: "Private task",
        logicalDate: DEMO_TODAY,
      })),
    );
    data.tasks.push(
      ...other.tasks.map((task) => ({ ...task, userId: "owner" })),
    );
    data.antiLogs.push(
      ...other.antiLogs.map((log) => ({
        ...log,
        userId: "owner",
        title: "Private activity",
        logicalDate: DEMO_TODAY,
      })),
    );
    data.antiEvents.push(
      ...other.antiEvents.map((event) => ({
        ...event,
        userId: "owner",
        title: "Private activity",
        logicalDate: DEMO_TODAY,
      })),
    );
    data.images.push({
      id: "private-photo",
      userId: "owner",
      logicalDate: DEMO_TODAY,
      storagePath: "",
      position: 0,
      revision: 0,
      deletedAt: null,
      createdAt: "",
      updatedAt: "",
    });
    expect(summary(data, DEMO_TODAY)).toMatchObject({
      recorded: false,
      completed: 0,
      workedOn: { life: [] },
      antiRotting: [],
    });
    expect(JSON.stringify(summary(data))).not.toContain("Private");
  });
});

describe("customized calendar history", () => {
  it("uses effective definitions, stable category IDs and matching answer generations", () => {
    const data = snapshot();
    data.configurations = [
      {
        id: "configuration",
        operationId: "configuration",
        userId,
        sequence: 1,
        baseRevision: 0,
        effectiveDate: "2026-10-13",
        createdAt: "2026-10-13T12:00:00Z",
        patch: {
          blocks: [
            {
              id: "custom-block",
              title: "General",
              icon: "activity",
              order: 9,
            },
          ],
          items: [
            {
              id: "water",
              label: "Water",
              blockId: "custom-block",
              kind: "number",
              generation: 2,
              order: 0,
              completion: {
                op: "compare",
                field: "value",
                operator: "gte",
                value: 4,
              },
              followups: [],
            },
          ],
        },
      },
    ];
    data.customAnswers = [
      {
        userId,
        logicalDate: DEMO_TODAY,
        itemId: "water",
        generation: 1,
        value: { generation: 1, value: true, fields: {}, selections: [] },
        revision: 1,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(summary(data, "2026-10-12").total).toBe(15);
    const day = summary(data, DEMO_TODAY);
    expect(day.total).toBe(16);
    expect(day.completed).toBe(0);
    expect(
      day.categories
        .filter((category) => category.title === "General")
        .map((category) => category.id),
    ).toEqual(["general", "custom-block"]);
    data.customAnswers.push({
      ...data.customAnswers[0],
      generation: 2,
      value: { generation: 2, value: 4, fields: {}, selections: [] },
    });
    expect(summary(data, DEMO_TODAY)).toMatchObject({
      completed: 1,
      recorded: true,
      blocks: { "custom-block": { completed: 1, total: 1 } },
    });
    data.customAnswers[1].userId = "someone-else";
    expect(summary(data, DEMO_TODAY).completed).toBe(0);
  });

  it("keeps custom list work and snapshots after list archival, while excluding archived deadlines", () => {
    const data = snapshot();
    data.configurations = [
      {
        id: "custom-list",
        operationId: "custom-list",
        userId,
        sequence: 1,
        baseRevision: 0,
        effectiveDate: DEMO_TODAY,
        createdAt: "",
        patch: {
          lists: [
            {
              id: "writing",
              title: "Writing",
              icon: "book",
              order: 4,
              deleted: true,
            },
          ],
          items: [
            {
              id: "writing-work",
              label: "Worked on writing?",
              blockId: "career",
              kind: "tasks",
              generation: 1,
              order: 5,
              listId: "writing",
              visibility: "relevant",
              completion: { op: "equals", field: "value", value: true },
              followups: [],
            },
          ],
        },
      },
    ];
    data.customAnswers = [
      {
        userId,
        logicalDate: DEMO_TODAY,
        itemId: "writing-work",
        generation: 1,
        value: {
          generation: 1,
          value: true,
          fields: {},
          selections: [
            {
              taskId: "draft",
              title: "First draft",
              manual: true,
              children: [],
            },
          ],
        },
        revision: 1,
        createdAt: "",
        updatedAt: "",
      },
    ];
    data.tasks.push({
      ...data.tasks[0],
      id: "draft",
      topic: "writing",
      title: "Renamed draft",
      deadline: { date: "2026-11-01" },
      completedAt: null,
    });
    const day = summary(data, DEMO_TODAY);
    expect(day.workedOn.writing).toMatchObject([
      { title: "First draft", workedOn: true },
    ]);
    expect(day.completed).toBe(1);
    expect(
      calendarDueTasks(
        data.tasks,
        userId,
        "America/New_York",
        new Set(["school", "career", "life"]),
      ).get("2026-11-01"),
    ).toBeUndefined();
  });

  it("keeps recorded selections from an earlier answer generation after a same-day type edit", () => {
    const data = snapshot();
    data.configurations = [
      {
        id: "link",
        operationId: "link",
        userId,
        sequence: 1,
        baseRevision: 0,
        effectiveDate: DEMO_TODAY,
        createdAt: "",
        patch: {
          items: [
            {
              id: "life-work",
              blockId: "general",
              label: "Life work",
              kind: "tasks",
              generation: 1,
              order: 9,
              listId: "life",
              visibility: "always",
              completion: { op: "equals", field: "value", value: true },
              followups: [],
            },
          ],
        },
      },
      {
        id: "type-change",
        operationId: "type-change",
        userId,
        sequence: 2,
        baseRevision: 1,
        effectiveDate: DEMO_TODAY,
        createdAt: "",
        patch: {
          items: [
            {
              id: "life-work",
              kind: "number",
              generation: 2,
              listId: undefined,
              completion: { op: "not-empty", field: "value" },
            },
          ],
        },
      },
    ];
    data.customAnswers = [
      {
        userId,
        logicalDate: DEMO_TODAY,
        itemId: "life-work",
        generation: 1,
        value: {
          generation: 1,
          value: true,
          fields: {},
          selections: [{ taskId: "walk", title: "Walk home", children: [] }],
        },
        revision: 1,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(summary(data, DEMO_TODAY).workedOn.life).toMatchObject([
      { title: "Walk home" },
    ]);
    expect(summary(data, DEMO_TODAY).completed).toBe(0);
  });
});
