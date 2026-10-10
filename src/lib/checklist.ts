import { weekday } from "./dates";
import {
  THRESHOLDS,
  timeMinutes,
  type ActivityTopic,
  type DailyData,
  type Task,
} from "./model";

export type ChecklistBlockTitle =
  "General" | "School" | "Career" | "Food" | "Body";
export interface ChecklistCount {
  completed: number;
  total: number;
}
export interface ChecklistProgress extends ChecklistCount {
  blocks: Record<ChecklistBlockTitle, ChecklistCount>;
}

export function cannabisComplete(
  data: Pick<DailyData, "cannabisStatus" | "cannabisCount">,
) {
  return (
    data.cannabisStatus === false ||
    (data.cannabisStatus === true && (data.cannabisCount ?? 1) <= 2)
  );
}

export function activityVisible(
  topic: ActivityTopic,
  roots: readonly Task[],
  status: DailyData["schoolTasksStatus"],
  reason: string,
  selections: DailyData["schoolTasksWorkedOn"],
) {
  return (
    roots.some((task) => task.topic === topic) ||
    status !== null ||
    !!reason.trim() ||
    selections.length > 0
  );
}

export function checklistProgress(
  data: DailyData,
  date: string,
  roots: readonly Task[],
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
    if (
      activityVisible(
        topic,
        roots,
        data[`${topic}TasksStatus`],
        data[`${topic}TasksReason`],
        data[`${topic}TasksWorkedOn`],
      )
    )
      (topic === "school" ? school : career).push(
        data[`${topic}TasksStatus`] === true,
      );
  }
  const blocks = {
    General: count([
      data.wakeTime !== null &&
        data.wakeTime !== "" &&
        timeMinutes(data.wakeTime) <= THRESHOLDS.wakeMinutes,
      data.screenTimeMinutes !== null &&
        data.screenTimeMinutes <= THRESHOLDS.screenMinutes,
      cannabisComplete(data),
    ]),
    School: count(school),
    Career: count(career),
    Food: count(
      [
        data.meal1Status,
        data.meal2Status,
        data.snack1Status,
        data.snack2Status,
        data.shakeStatus,
      ].map((status) => status === true),
    ),
    Body: count(
      [data.amPostureStatus, data.pmPostureStatus, data.liftedStatus].map(
        (status) => status === true,
      ),
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
