import { expect, it } from "vitest";
import {
  deadlineFromInput,
  deadlineInput,
  deadlineInstant,
  deadlinePresentation,
  validateDeadline,
} from "./taskDeadlines";
import { sortTasks } from "./tasks";
import type { Task } from "./model";
const zone = "America/New_York";

it("validates exact dates, UTC instants, and root-only metadata", () => {
  for (const value of [
    { date: "2028-02-29" },
    { at: "2026-10-15T21:00:00.000Z" },
    null,
  ])
    expect(() => validateDeadline(value)).not.toThrow();
  for (const value of [
    { date: "2026-02-29" },
    { date: "2026-2-01" },
    { at: "2026-02-30T21:00:00.000Z" },
    { at: "2026-10-15T24:00:00.000Z" },
    { at: "2026-10-15T17:00:00-04:00" },
    {},
    [],
    "2026-10-15",
    { date: "2026-10-15", at: "2026-10-15T21:00:00.000Z" },
    undefined,
  ])
    expect(() => validateDeadline(value)).toThrow();
  expect(() => validateDeadline({ date: "2026-10-15" }, "parent")).toThrow(
    /top-level/,
  );
  expect(() => validateDeadline(null, "parent")).not.toThrow();
});
it("converts chosen times without changing their instant after travel", () => {
  const due = deadlineFromInput("2026-10-15", "17:00", zone);
  expect(due).toEqual({ at: "2026-10-15T21:00:00.000Z" });
  expect(deadlineInput(due, "America/Los_Angeles")).toEqual({
    date: "2026-10-15",
    time: "14:00",
  });
  expect(deadlineInput(due, "Asia/Tokyo")).toEqual({
    date: "2026-10-16",
    time: "06:00",
  });
  expect(deadlineFromInput("2026-10-15", "17:00", "Asia/Kathmandu")).toEqual({
    at: "2026-10-15T11:15:00.000Z",
  });
  expect(deadlineInput({ date: "2026-10-15" }, "Asia/Tokyo")).toEqual({
    date: "2026-10-15",
    time: "",
  });
});
it("rejects skipped DST times and selects the first occurrence of repeated times", () => {
  expect(() => deadlineFromInput("2027-03-14", "02:30", zone)).toThrow(
    /doesn’t exist/,
  );
  expect(deadlineFromInput("2026-11-01", "01:30", zone)).toEqual({
    at: "2026-11-01T05:30:00.000Z",
  });
  expect(() =>
    deadlineFromInput("2026-10-04", "02:15", "Australia/Lord_Howe"),
  ).toThrow(/doesn’t exist/);
  expect(() => deadlineFromInput("2026-10-15", "25:00", zone)).toThrow(
    /valid due time/,
  );
});
it("uses calendar midnight, including a 23-hour DST day, rather than 2 AM", () => {
  const due = { date: "2027-03-14" };
  const end = Date.parse("2027-03-15T04:00:00Z");
  expect(deadlineInstant(due, zone)).toBe(end);
  expect(deadlinePresentation(due, end - 1, zone, false).overdue).toBe(false);
  expect(deadlinePresentation(due, end, zone, false).overdue).toBe(true);
  expect(deadlineInstant({ date: "2018-11-03" }, "America/Sao_Paulo")).toBe(
    Date.parse("2018-11-04T03:00:00Z"),
  );
  expect(deadlineInstant({ date: "0001-01-01" }, "UTC")).toBe(
    Date.parse("0001-01-02T00:00:00Z"),
  );
  expect(deadlineInstant({ date: "9999-12-31" }, "UTC")).toBe(
    Date.parse("+010000-01-01T00:00:00Z"),
  );
});
it("formats dates, timed expiry, new-year labels and completed rows", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  expect(
    deadlinePresentation({ date: "2026-10-15" }, now, zone, false).label,
  ).toBe("Due today");
  expect(
    deadlinePresentation({ date: "2026-10-16" }, now, zone, false).label,
  ).toBe("Due tomorrow");
  const due = deadlineFromInput("2026-10-15", "08:00", zone);
  expect(deadlinePresentation(due, now, zone, false)).toEqual({
    label: "Overdue · Oct 15 · 8:00 AM",
    overdue: true,
  });
  expect(deadlinePresentation(due, now, zone, true)).toEqual({
    label: "Due today · 8:00 AM",
    overdue: false,
  });
  expect(
    deadlinePresentation({ date: "2027-01-05" }, now, zone, false).label,
  ).toBe("Due Jan 5, 2027");
});
it("sorts priority then deadlines, with undated last and completed and child ordering preserved", () => {
  const root: Task = {
    id: "base",
    userId: "owner",
    topic: "school",
    parentId: null,
    title: "Task",
    createdAt: "2026-10-15T12:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    completedAt: null,
    deletedAt: null,
    revision: 0,
  };
  const tasks: Task[] = [
    { ...root, id: "plain" },
    { ...root, id: "urgent", highPriority: true },
    { ...root, id: "all-day", deadline: { date: "2026-10-15" } },
    { ...root, id: "timed", deadline: { at: "2026-10-15T21:00:00.000Z" } },
    {
      ...root,
      id: "urgent-due",
      highPriority: true,
      deadline: { date: "2026-10-17" },
    },
    {
      ...root,
      id: "finished",
      completedAt: root.createdAt,
      deadline: { date: "2026-10-01" },
    },
  ];
  expect(sortTasks(tasks, zone).map((task) => task.id)).toEqual([
    "urgent-due",
    "urgent",
    "timed",
    "all-day",
    "plain",
    "finished",
  ]);
  expect(
    sortTasks(
      tasks.slice(0, 2).map((task) => ({ ...task, parentId: "parent" })),
      zone,
    ).map((task) => task.id),
  ).toEqual(["plain", "urgent"]);
});
