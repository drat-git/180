import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
import { createDemoSeed, seedDemo } from "./demo";
import {
  DEMO_MODE,
  DEMO_NOW,
  DEMO_TODAY,
  PRIVATE_MODE,
  clockForUser,
  modeForUser,
  recordedDateForUser,
  todayForUser,
} from "./appMode";
import { canNavigate, dayNumber } from "./dates";
import { cannabisComplete, checklistProgress, wakeComplete } from "./checklist";
import { emptyData, reasonVisible } from "./model";
import { taskActivityVisibility } from "./taskActivityVisibility";
import { visibleRoots } from "./tasks";
import { antiRecap, visibleAntiItems } from "./antiRotting";

const userId = "local-demo:tests";
const database = new AppDatabase("180-demo-tests");
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(database.tables.map((table) => table.clear()));
});

describe("demo policy and history", () => {
  it("fixes demo dates and time without changing private defaults", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-15T12:00:00Z"));
    expect(todayForUser(userId)).toBe(DEMO_TODAY);
    expect(clockForUser(userId).getTime()).toBe(Date.parse(DEMO_NOW));
    expect(recordedDateForUser(userId, clockForUser(userId))).toBe(DEMO_TODAY);
    expect(clockForUser("owner").getTime()).toBe(Date.now());
    expect(modeForUser("owner")).toBe(PRIVATE_MODE);
    expect(dayNumber("2026-10-13")).toBe(5);
    expect(dayNumber("2026-10-13", DEMO_MODE.startDate)).toBe(3);
    expect(canNavigate("2026-10-10", DEMO_TODAY, DEMO_MODE.startDate)).toBe(
      false,
    );
    expect(canNavigate("2026-10-14", DEMO_TODAY, DEMO_MODE.startDate)).toBe(
      false,
    );
    expect(canNavigate("2026-10-09", DEMO_TODAY)).toBe(true);
  });
  it("uses demo-only wake and vaping rules at their boundaries", () => {
    const data = emptyData();
    data.wakeTime = "08:30";
    expect(wakeComplete(data, DEMO_MODE)).toBe(true);
    expect(reasonVisible("wake", data, DEMO_MODE.wakeMinutes)).toBe(false);
    data.wakeTime = "08:31";
    expect(wakeComplete(data, DEMO_MODE)).toBe(false);
    expect(reasonVisible("wake", data, DEMO_MODE.wakeMinutes)).toBe(true);
    expect(wakeComplete(data)).toBe(true);
    expect(reasonVisible("wake", data)).toBe(false);
    data.cannabisStatus = true;
    data.cannabisCount = 1;
    expect(cannabisComplete(data, DEMO_MODE)).toBe(false);
    expect(cannabisComplete(data)).toBe(true);
    data.cannabisCount = 0;
    expect(cannabisComplete(data, DEMO_MODE)).toBe(false);
    data.cannabisStatus = false;
    expect(cannabisComplete(data, DEMO_MODE)).toBe(true);
    data.cannabisStatus = null;
    expect(cannabisComplete(data, DEMO_MODE)).toBe(false);
  });
  it("seeds believable historical applicability, progress and retained snapshots", () => {
    const seed = createDemoSeed(userId);
    const counts = seed.entries.map((entry) => {
      const visibility = taskActivityVisibility(
        entry.data,
        entry.logicalDate,
        DEMO_TODAY,
        seed.tasks,
        seed.taskEvents,
        true,
        DEMO_MODE,
      );
      return checklistProgress(
        entry.data,
        entry.logicalDate,
        visibility,
        DEMO_MODE,
      );
    });
    expect(counts).toMatchObject([
      { completed: 12, total: 13, blocks: { School: { total: 0 } } },
      { completed: 10, total: 15 },
      { completed: 0, total: 15 },
    ]);
    expect(seed.entries[2].data).toEqual(emptyData());
    const visible = visibleRoots(seed.tasks, Date.parse(DEMO_NOW));
    expect(visible.filter((t) => t.topic === "school")).toHaveLength(3);
    expect(visible.filter((t) => t.topic === "career")).toHaveLength(3);
    expect(visible.filter((t) => t.topic === "life")).toHaveLength(4);
    expect(
      visible.find((t) => t.title === "Build a campus events project")
        ?.completedAt,
    ).not.toBeNull();
    expect(visible.map((t) => t.title)).not.toContain(
      "Refresh LinkedIn profile",
    );
    expect(visible.map((t) => t.title)).not.toContain(
      "Finish statistics practice set",
    );
    expect(seed.entries[0].data.careerTasksWorkedOn[0].title).toBe(
      "Refresh LinkedIn profile",
    );
    expect(seed.entries[1].data.schoolTasksWorkedOn[0].title).toBe(
      "Finish statistics practice set",
    );
    expect(visibleAntiItems(seed.items, Date.parse(DEMO_NOW))).toHaveLength(6);
    expect(antiRecap(seed.logs, seed.events, "2026-10-11")).toHaveLength(2);
    expect(
      antiRecap(seed.logs, seed.events, "2026-10-12").some((r) => r.completed),
    ).toBe(true);
    expect(antiRecap(seed.logs, seed.events, DEMO_TODAY)).toHaveLength(0);
  });
});

describe("demo storage boundary", () => {
  it("seeds once, keeps edits and resets only the selected demo visit", async () => {
    const repo = new LocalRepository(database);
    await repo.patchDay("owner", DEMO_TODAY, {
      journalText: "Private journal",
    });
    await seedDemo(userId, false, database);
    await seedDemo("local-demo:other", false, database);
    await repo.patchDay(userId, DEMO_TODAY, { journalText: "Visitor edit" });
    await seedDemo(userId, false, database);
    expect((await repo.getDay(userId, DEMO_TODAY))?.data.journalText).toBe(
      "Visitor edit",
    );
    const count = await database.tasks.count();
    await seedDemo(userId, true, database);
    expect(await database.tasks.count()).toBe(count);
    expect((await repo.getDay(userId, DEMO_TODAY))?.data).toEqual(emptyData());
    expect((await repo.getDay("owner", DEMO_TODAY))?.data.journalText).toBe(
      "Private journal",
    );
    expect(await repo.getDay("local-demo:other", DEMO_TODAY)).toBeDefined();
    expect(await database.outbox.count()).toBe(1);
    await expect(seedDemo("owner", true, database)).rejects.toThrow(
      "private account",
    );
  });
  it("records demo actions on Day 3 without queuing any cloud writes", async () => {
    const repo = new LocalRepository(database);
    await seedDemo(userId, false, database);
    await repo.patchDay(userId, DEMO_TODAY, { wakeTime: "08:00" });
    const taskId = await repo.createTask(userId, "school", "Visitor task");
    await repo.completeTask(userId, taskId, true);
    await repo.completeTask(userId, taskId, false);
    await repo.completeTask(userId, taskId, true);
    await repo.antiOperation(userId, {
      itemId: `${userId}:walk`,
      action: "log",
      logged: true,
    });
    expect(await database.outbox.count()).toBe(0);
    const task = await database.tasks.get(taskId);
    expect(task?.completedAt).toBe(new Date(DEMO_NOW).toISOString());
    const events = await database.taskEvents
      .where("[userId+taskId]")
      .equals([userId, taskId])
      .toArray();
    expect(events).toHaveLength(3);
    expect(
      events.every(
        (e) =>
          e.logicalDate === DEMO_TODAY && e.timezone === "America/New_York",
      ),
    ).toBe(true);
    const entry = (await repo.getDay(userId, DEMO_TODAY))!;
    expect(
      taskActivityVisibility(
        entry.data,
        DEMO_TODAY,
        DEMO_TODAY,
        [task!],
        events,
        true,
        DEMO_MODE,
      ).school,
    ).toBe(true);
    expect(
      (await database.antiLogs.get(`${userId}:${userId}:walk:${DEMO_TODAY}`))
        ?.manual,
    ).toBe(true);
  });
  it("rolls failed seeding back instead of leaving partially prepared data", async () => {
    const put = vi
      .spyOn(database.tasks, "bulkPut")
      .mockRejectedValueOnce(new Error("Storage full"));
    await expect(seedDemo(userId, false, database)).rejects.toThrow(
      "Storage full",
    );
    expect(await database.entries.count()).toBe(0);
    expect(await database.meta.count()).toBe(0);
    put.mockRestore();
    await seedDemo(userId, false, database);
    expect(await database.entries.count()).toBe(3);
  });
});
