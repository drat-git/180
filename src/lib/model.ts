export const START_DATE = "2026-10-09";
export const THRESHOLDS = {
  wakeMinutes: 600,
  screenMinutes: 210,
} as const;
export type Answer = boolean | null;
export const CREATINE_START_DATE = "2026-10-13";
export const creatineVisible = (date: string) => date >= CREATINE_START_DATE;
export const FOOD_UPDATE_DATE = "2026-10-12";
export const newFoodChecklist = (date: string) => date >= FOOD_UPDATE_DATE;
export type BreakfastChoice = "shake" | "meal";
export interface BreakfastAnswer {
  status: Answer;
  choice: BreakfastChoice | null;
}
export const breakfastLabels = {
  shake: "AM shake",
  meal: "Calorie dense meal",
} as const;
export const breakfastLabel = "AM Shake/Calorie-Dense Breakfast";
export function breakfastAnswerPatch(
  current: BreakfastAnswer,
  answer: boolean,
): EntryPatch {
  return {
    amBreakfast: {
      status: current.status === answer ? null : answer,
      choice: null,
    },
  };
}
export function breakfastComplete(data: Pick<DailyData, "amBreakfast">) {
  return data.amBreakfast.status === true && data.amBreakfast.choice !== null;
}
export const binaryFields = [
  { key: "meal1", label: "Meal 1", description: true },
  { key: "meal2", label: "Meal 2", description: true },
  { key: "snack1", label: "Snack 1", description: true },
  { key: "snack2", label: "Snack 2", description: true },
  { key: "shake", label: "Bulking shake" },
  { key: "snack", label: "Snack", description: true },
  { key: "amPosture", label: "AM posture exercises" },
  { key: "pmPosture", label: "PM posture exercises" },
  { key: "lifted", label: "Lifted" },
  { key: "creatine", label: "Creatine", fromDate: CREATINE_START_DATE },
  { key: "classAttendance", label: "Attended class", weekdays: true },
  { key: "cannabis", label: "Used cannabis?", count: true },
  {
    key: "applications",
    label: "Applied to jobs or internships",
    count: true,
  },
] as const;
export type BinaryKey = (typeof binaryFields)[number]["key"];
export type ReasonKey = BinaryKey | "wake" | "screenTime";
export type DailyData = Record<`${BinaryKey}Status`, Answer> &
  Record<`${ReasonKey}Reason`, string> & {
    amBreakfast: BreakfastAnswer;
    amBreakfastReason: string;
    amBreakfastDescription: string;
    snackDescription: string;
    schoolTasksStatus: Answer;
    careerTasksStatus: Answer;
    schoolTasksReason: string;
    careerTasksReason: string;
    schoolTasksWorkedOn: TaskSelection[];
    careerTasksWorkedOn: TaskSelection[];
    wakeTime: string | null;
    screenTimeMinutes: number | null;
    journalText: string;
    meal1Description: string;
    meal2Description: string;
    snack1Description: string;
    snack2Description: string;
    cannabisCount: number | null;
    cannabisUseDescriptions: string[];
    applicationsCount: number | null;
  };
export type TaskTopic = "school" | "career" | "life";
export type ActivityTopic = "school" | "career";
export interface SelectionProvenance {
  // Missing provenance on legacy selections means independent manual work.
  manual?: boolean;
  automatic?: string;
}
export interface TaskSelection extends SelectionProvenance {
  taskId: string;
  title: string;
  children: ({ taskId: string; title: string } & SelectionProvenance)[];
}
export interface TaskDailyChange {
  topic: ActivityTopic;
  parent: { taskId: string; title: string };
  child?: { taskId: string; title: string };
  completed: boolean;
}
export interface TaskOptions {
  estimatedMinutes?: number | null;
  highPriority?: boolean;
}
export interface Task extends TaskOptions {
  id: string;
  userId: string;
  topic: TaskTopic;
  parentId: string | null;
  title: string;
  completedAt: string | null;
  deletedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface TaskCommand extends TaskOptions {
  recordDaily?: boolean;
  taskId: string;
  action: "create" | "rename" | "complete" | "delete" | "options";
  title?: string;
  topic?: TaskTopic;
  parentId?: string | null;
  completed?: boolean;
  at: string;
  logicalDate: string;
  timezone: string;
}
export interface TaskEvent {
  id: string;
  operationId: string;
  userId: string;
  taskId: string;
  parentId: string | null;
  topic: TaskTopic;
  title: string;
  type: "completed" | "reopened";
  at: string;
  logicalDate: string;
  timezone: string;
}
export type AntiItemType = "reusable" | "one-time";
export interface AntiItem {
  id: string;
  userId: string;
  title: string;
  notes: string;
  itemType: AntiItemType;
  completedAt: string | null;
  completionOperationId: string | null;
  deletedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface AntiLog {
  id: string;
  userId: string;
  itemId: string;
  logicalDate: string;
  title: string;
  notes: string;
  itemType: AntiItemType;
  manual: boolean;
  completionOperationId: string | null;
  at: string;
  timezone: string;
  revision: number;
}
export interface AntiEvent {
  id: string;
  operationId: string;
  userId: string;
  itemId: string;
  title: string;
  notes: string;
  itemType: AntiItemType;
  type: "completed" | "reopened";
  at: string;
  logicalDate: string;
  timezone: string;
  sequence: number;
}
export interface AntiCommand {
  itemId: string;
  action: "create" | "edit" | "log" | "complete" | "delete";
  title?: string;
  notes?: string;
  itemType?: AntiItemType;
  logged?: boolean;
  completed?: boolean;
  at: string;
  logicalDate: string;
  timezone: string;
}
export type EntryPatch = Partial<DailyData>;
export interface DailyEntry {
  userId: string;
  logicalDate: string;
  data: DailyData;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface JournalImage {
  id: string;
  userId: string;
  logicalDate: string;
  storagePath: string;
  position: number;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  localError?: string;
}
export interface ImageBlob {
  id: string;
  userId: string;
  blob: Blob;
  normalized: boolean;
}
export interface PendingOperation {
  id?: number;
  operationId: string;
  userId: string;
  logicalDate: string;
  kind: "entry" | "photo-add" | "photo-delete" | "task" | "anti-rotting";
  taskCommand?: TaskCommand;
  taskDailyChange?: TaskDailyChange;
  antiCommand?: AntiCommand;
  patch?: EntryPatch;
  imageId?: string;
  createdAt: string;
}
export const emptyData = (): DailyData =>
  ({
    amBreakfast: { status: null, choice: null },
    amBreakfastReason: "",
    amBreakfastDescription: "",
    snackDescription: "",
    schoolTasksStatus: null,
    careerTasksStatus: null,
    schoolTasksReason: "",
    careerTasksReason: "",
    schoolTasksWorkedOn: [],
    careerTasksWorkedOn: [],
    wakeTime: null,
    wakeReason: "",
    screenTimeMinutes: null,
    screenTimeReason: "",
    journalText: "",
    meal1Description: "",
    meal2Description: "",
    snack1Description: "",
    snack2Description: "",
    cannabisCount: null,
    cannabisUseDescriptions: [],
    applicationsCount: null,
    ...(Object.fromEntries(
      binaryFields.flatMap(({ key }) => [
        [`${key}Status`, null],
        [`${key}Reason`, ""],
      ]),
    ) as Record<`${BinaryKey}Status`, Answer> &
      Record<`${BinaryKey}Reason`, string>),
  }) as DailyData;
export function reasonVisible(
  key: ReasonKey,
  data: DailyData,
  wakeMinutes: number = THRESHOLDS.wakeMinutes,
): boolean {
  if (key === "wake")
    return !!data.wakeTime && timeMinutes(data.wakeTime) > wakeMinutes;
  if (key === "screenTime")
    return (
      data.screenTimeMinutes !== null &&
      data.screenTimeMinutes > THRESHOLDS.screenMinutes
    );
  if (key === "cannabis") return false;
  return data[`${key}Status`] === false;
}
export function timeMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
export function answerPatch(
  key: BinaryKey,
  current: Answer,
  answer: boolean,
  data: DailyData,
): EntryPatch {
  const next = current === answer ? null : answer;
  return {
    [`${key}Status`]: next,
    ...(next === true &&
    (key === "cannabis" || key === "applications") &&
    !data[`${key}Count`]
      ? { [`${key}Count`]: 1 }
      : {}),
  };
}

export function createId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
