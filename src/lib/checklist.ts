import { weekday } from "./dates";
import {
  THRESHOLDS,
  timeMinutes,
  breakfastComplete,
  newFoodChecklist,
  creatineVisible,
  type DailyData,
} from "./model";

import type { TaskActivityVisibility } from "./taskActivityVisibility";
import { PRIVATE_MODE, type AppMode } from "./appMode";

export type ChecklistBlockTitle =
  "General" | "School" | "Career" | "Food" | "Body";
export interface ChecklistCount {
  completed: number;
  total: number;
}
export interface ChecklistProgress extends ChecklistCount {
  blocks: Record<ChecklistBlockTitle, ChecklistCount>;
}

export function wakeComplete(
  data: Pick<DailyData, "wakeTime">,
  mode: AppMode = PRIVATE_MODE,
) {
  return (
    data.wakeTime !== null &&
    data.wakeTime !== "" &&
    timeMinutes(data.wakeTime) <= mode.wakeMinutes
  );
}

export function screenTimeComplete(data: Pick<DailyData, "screenTimeMinutes">) {
  return (
    data.screenTimeMinutes !== null &&
    data.screenTimeMinutes <= THRESHOLDS.screenMinutes
  );
}

export function cannabisComplete(
  data: Pick<DailyData, "cannabisStatus" | "cannabisCount">,
  mode: AppMode = PRIVATE_MODE,
) {
  return (
    data.cannabisStatus === false ||
    (mode.cannabisUseLimit !== null &&
      data.cannabisStatus === true &&
      (data.cannabisCount ?? 1) <= mode.cannabisUseLimit)
  );
}

export function checklistProgress(
  data: DailyData,
  date: string,
  activity: TaskActivityVisibility,
  mode: AppMode = PRIVATE_MODE,
): ChecklistProgress {
  const count = (checks: boolean[]): ChecklistCount => ({
    completed: checks.filter(Boolean).length,
    total: checks.length,
  });
  const school =
    weekday(date) !== 0 && weekday(date) !== 6
      ? [data.classAttendanceStatus === true]
      : [];
  const career = [data.applicationsStatus === true];
  for (const topic of ["school", "career"] as const) {
    if (activity[topic])
      (topic === "school" ? school : career).push(
        data[`${topic}TasksStatus`] === true,
      );
  }
  const blocks = {
    General: count([
      wakeComplete(data, mode),
      screenTimeComplete(data),
      cannabisComplete(data, mode),
    ]),
    School: count(school),
    Career: count(career),
    Food: count(
      mode.modernFood || newFoodChecklist(date)
        ? [
            breakfastComplete(data),
            ...[
              data.meal1Status,
              data.meal2Status,
              data.shakeStatus,
              data.snackStatus,
            ].map((status) => status === true),
          ]
        : [
            data.meal1Status,
            data.meal2Status,
            data.snack1Status,
            data.snack2Status,
            data.shakeStatus,
          ].map((status) => status === true),
    ),
    Body: count(
      mode.bodyFields
        .filter(
          (key) => mode.demo || key !== "creatine" || creatineVisible(date),
        )
        .map((key) => data[`${key}Status`] === true),
    ),
  };
  return {
    blocks,
    completed: Object.values(blocks).reduce(
      (sum, block) => sum + block.completed,
      0,
    ),
    total: Object.values(blocks).reduce((sum, block) => sum + block.total, 0),
  };
}
