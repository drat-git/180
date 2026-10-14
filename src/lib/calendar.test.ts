import { describe, expect, it } from "vitest";
import { DEMO_MODE, DEMO_TODAY } from "./appMode";
import {
  calendarDaySummary,
  completionBand,
  completionPercent,
  monthDates,
  shiftMonth,
  type CalendarSnapshot,
} from "./calendar";
import { createDemoSeed } from "./demo";
import { applyAntiCommand } from "./antiRotting";
import { emptyData, type TaskEvent } from "./model";

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

describe("calendar scoring and month geometry", () => {
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
      completed: 12,
      total: 13,
      band: 4,
      blocks: { School: { total: 0 } },
    });
    expect(summary(data)).toMatchObject({ completed: 10, total: 15, band: 3 });
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
    expect(day).toMatchObject({ completed: 10, total: 15 });
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
