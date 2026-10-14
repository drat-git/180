import { addDays, logicalDate } from "./dates";
import {
  START_DATE,
  THRESHOLDS,
  breakfastLabel,
  breakfastLabels,
  type BinaryKey,
} from "./model";

export const DEMO_PREFIX = "local-demo:";
export const DEMO_SESSION_KEY = "180:demo-session";
export const DEMO_TODAY = "2026-10-13";
export const DEMO_NOW = "2026-10-13T08:00:00-04:00";
export interface AppMode {
  demo: boolean;
  startDate: string;
  wakeMinutes: number;
  cannabisUseLimit: number | null;
  modernFood: boolean;
  bodyFields: BinaryKey[];
  labels: Partial<Record<BinaryKey, string>>;
  breakfastLabel: string;
  breakfastLabels: { shake: string; meal: string };
}
export const PRIVATE_MODE: AppMode = {
  demo: false,
  startDate: START_DATE,
  wakeMinutes: THRESHOLDS.wakeMinutes,
  cannabisUseLimit: 2,
  modernFood: false,
  bodyFields: ["amPosture", "pmPosture", "lifted", "creatine"],
  labels: {},
  breakfastLabel,
  breakfastLabels,
};
// Demo labels reuse the local record format, but never a private record owner.
export const DEMO_MODE: AppMode = {
  demo: true,
  startDate: "2026-10-11",
  wakeMinutes: 510,
  cannabisUseLimit: null,
  modernFood: true,
  bodyFields: ["pmPosture", "lifted", "creatine"],
  labels: {
    cannabis: "Vaped",
    shake: "Creatine",
    pmPosture: "8500 steps",
    lifted: "Exercised",
    creatine: "Multivitamin",
  },
  breakfastLabel: "Breakfast",
  breakfastLabels: { shake: "Smoothie", meal: "Meal" },
};
export const isDemoUser = (userId: string) => userId.startsWith(DEMO_PREFIX);
export const modeForUser = (userId: string) =>
  isDemoUser(userId) ? DEMO_MODE : PRIVATE_MODE;
export const clockForUser = (userId: string) =>
  isDemoUser(userId) ? new Date(DEMO_NOW) : new Date();
export const todayForUser = (userId: string) =>
  isDemoUser(userId) ? DEMO_TODAY : logicalDate();
export const timezoneForUser = (userId: string) =>
  isDemoUser(userId)
    ? "America/New_York"
    : Intl.DateTimeFormat().resolvedOptions().timeZone;

export function demoLogicalDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return Number(part("hour")) < 2 ? addDays(date, -1) : date;
}

export function recordedDateForUser(userId: string, now: Date) {
  return isDemoUser(userId) ? demoLogicalDate(now) : logicalDate(now);
}
