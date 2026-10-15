import { THRESHOLDS, timeMinutes, type DailyData } from "./model";

import {
  answersForConfiguration,
  customChecklistProgress,
  defaultConfiguration,
  LEGACY_BLOCK_TITLES,
} from "./customization";
import type { TaskActivityVisibility } from "./taskActivityVisibility";
import { PRIVATE_MODE, type AppMode } from "./appMode";

export type ChecklistBlockTitle =
  "General" | "School" | "Career" | "Food" | "Body";
export interface ChecklistCount {
  completed: number;
  total: number;
}
export interface ChecklistProgress extends ChecklistCount {
  blocks: Record<string, ChecklistCount>;
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
  const configuration = defaultConfiguration(
    mode.demo ? "local-demo:default" : "default",
    date,
    mode,
  );
  const progress = customChecklistProgress(
    configuration,
    answersForConfiguration(configuration, data),
    date,
    activity,
  );
  const blocks = Object.fromEntries(
    Object.entries(LEGACY_BLOCK_TITLES).map(([id, title]) => [
      title,
      progress.blocks[id],
    ]),
  ) as Record<ChecklistBlockTitle, ChecklistCount>;
  return { completed: progress.completed, total: progress.total, blocks };
}
