import { START_DATE } from "./model";
export function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateOrdinal(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
export function addDays(date: string, count: number): string {
  return new Date((dateOrdinal(date) + count) * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function logicalDate(now = new Date()): string {
  const date = calendarDate(now);
  return now.getHours() < 2 ? addDays(date, -1) : date;
}
export function dayNumber(date: string): number {
  return dateOrdinal(date) - dateOrdinal(START_DATE) + 1;
}
export function weekday(date: string): number {
  return new Date(dateOrdinal(date) * 86400000).getUTCDay();
}
export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateOrdinal(date) * 86400000));
}
export function canNavigate(date: string, today: string): boolean {
  return date >= START_DATE && date <= today;
}
export function needsUnlock(date: string, today: string): boolean {
  return dateOrdinal(today) - dateOrdinal(date) > 1;
}
