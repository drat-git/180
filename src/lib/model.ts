export const START_DATE = "2026-10-09";
export const THRESHOLDS = {
  wakeMinutes: 600,
  screenMinutes: 210,
} as const;
export type Answer = boolean | null;
export const binaryFields = [
  { key: "meal1", label: "Meal 1", description: true },
  { key: "meal2", label: "Meal 2", description: true },
  { key: "snack1", label: "Snack 1", description: true },
  { key: "snack2", label: "Snack 2", description: true },
  { key: "shake", label: "Bulking shake" },
  { key: "amPosture", label: "AM posture exercises" },
  { key: "pmPosture", label: "PM posture exercises" },
  { key: "lifted", label: "Lifted" },
  { key: "classAttendance", label: "Attended class", weekdays: true },
  { key: "cannabis", label: "Used cannabis?", count: true },
  {
    key: "applications",
    label: "Applied to jobs or internships?",
    count: true,
  },
] as const;
export type BinaryKey = (typeof binaryFields)[number]["key"];
export type ReasonKey = BinaryKey | "wake" | "screenTime";
export type DailyData = Record<`${BinaryKey}Status`, Answer> &
  Record<`${ReasonKey}Reason`, string> & {
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
  kind: "entry" | "photo-add" | "photo-delete";
  patch?: EntryPatch;
  imageId?: string;
  createdAt: string;
}
export const emptyData = (): DailyData =>
  ({
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
export function reasonVisible(key: ReasonKey, data: DailyData): boolean {
  if (key === "wake")
    return (
      !!data.wakeTime && timeMinutes(data.wakeTime) > THRESHOLDS.wakeMinutes
    );
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
