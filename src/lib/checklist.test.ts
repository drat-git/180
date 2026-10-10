import { describe, expect, it } from "vitest";
import { checklistProgress } from "./checklist";
import { binaryFields, emptyData, type Task } from "./model";

const weekday = "2026-10-12";
const weekend = "2026-10-11";
const root = (topic: Task["topic"]): Task => ({
  id: topic,
  userId: "owner",
  topic,
  parentId: null,
  title: topic,
  completedAt: null,
  deletedAt: null,
  revision: 0,
  createdAt: "2026-10-09T12:00:00Z",
  updatedAt: "2026-10-09T12:00:00Z",
});

describe("daily checklist progress", () => {
  it("counts unanswered visible questions and excludes weekend attendance", () => {
    expect(checklistProgress(emptyData(), weekday, [])).toMatchObject({
      completed: 0,
      total: 13,
    });
    expect(checklistProgress(emptyData(), weekend, [])).toMatchObject({
      completed: 0,
      total: 12,
      blocks: { School: { completed: 0, total: 0 } },
    });
  });
  it("accepts exact wake and screen thresholds, including midnight and zero screen time", () => {
    const data = emptyData();
    data.wakeTime = "10:00";
    data.screenTimeMinutes = 210;
    expect(checklistProgress(data, weekday, []).blocks.General.completed).toBe(
      2,
    );
    data.wakeTime = "10:01";
    data.screenTimeMinutes = 211;
    expect(checklistProgress(data, weekday, []).blocks.General.completed).toBe(
      0,
    );
    data.wakeTime = "00:00";
    data.screenTimeMinutes = 0;
    expect(checklistProgress(data, weekday, []).blocks.General.completed).toBe(
      2,
    );
    data.wakeTime = null;
    data.screenTimeMinutes = null;
    expect(checklistProgress(data, weekday, []).blocks.General.completed).toBe(
      0,
    );
  });
  it("uses the cannabis answer and threshold without counting preserved hidden values", () => {
    const data = emptyData();
    data.cannabisCount = 2;
    expect(checklistProgress(data, weekday, []).completed).toBe(0);
    data.cannabisStatus = true;
    expect(checklistProgress(data, weekday, []).completed).toBe(1);
    data.cannabisCount = 3;
    expect(checklistProgress(data, weekday, []).completed).toBe(0);
    data.cannabisStatus = false;
    expect(checklistProgress(data, weekday, []).completed).toBe(1);
    data.cannabisStatus = null;
    expect(checklistProgress(data, weekday, []).completed).toBe(0);
    data.cannabisStatus = true;
    data.cannabisCount = null;
    expect(checklistProgress(data, weekday, []).completed).toBe(1);
  });
  it("counts binary Yes only and sums all five blocks", () => {
    const data = emptyData();
    for (const { key } of binaryFields) data[`${key}Status`] = true;
    data.wakeTime = "09:00";
    data.screenTimeMinutes = 180;
    data.cannabisCount = 2;
    expect(checklistProgress(data, weekday, [])).toEqual({
      completed: 13,
      total: 13,
      blocks: {
        General: { completed: 3, total: 3 },
        School: { completed: 1, total: 1 },
        Career: { completed: 1, total: 1 },
        Food: { completed: 5, total: 5 },
        Body: { completed: 3, total: 3 },
      },
    });
    data.meal1Status = false;
    data.liftedStatus = null;
    expect(checklistProgress(data, weekday, []).completed).toBe(11);
    expect(checklistProgress(data, weekend, []).completed).toBe(10);
  });
  it("counts visible task questions once, without counting individual selected tasks", () => {
    const data = emptyData();
    const roots = [root("school"), root("career"), root("life")];
    expect(checklistProgress(data, weekday, roots).total).toBe(15);
    data.schoolTasksStatus = true;
    data.careerTasksStatus = false;
    data.schoolTasksWorkedOn = [
      {
        taskId: "school",
        title: "School",
        children: [{ taskId: "child", title: "Read" }],
      },
    ];
    expect(checklistProgress(data, weekend, roots)).toMatchObject({
      completed: 1,
      total: 14,
      blocks: {
        School: { completed: 1, total: 1 },
        Career: { completed: 0, total: 2 },
      },
    });
    expect(checklistProgress(data, weekend, []).total).toBe(14);
    data.schoolTasksStatus = null;
    expect(checklistProgress(data, weekend, []).blocks.School).toEqual({
      completed: 0,
      total: 1,
    });
  });
});
