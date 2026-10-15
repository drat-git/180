import type { TaskDeadline } from "./model";
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().split("T")[0];
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function deadlineLocalParts(stamp: number, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      era: "short",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 32) formatters.clear();
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(stamp);
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  const year =
    get("era") === "BC" ? 1 - Number(get("year")) : Number(get("year"));
  const isoYear =
    year < 0
      ? `-${String(-year).padStart(6, "0")}`
      : year > 9999
        ? `+${String(year).padStart(6, "0")}`
        : String(year).padStart(4, "0");
  return {
    date: `${isoYear}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function validDeadlineDate(date: unknown): date is string {
  return (
    typeof date === "string" &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) &&
    date >= "0001-01-01" &&
    date <= "9999-12-31" &&
    Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) &&
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date
  );
}
export function validateDeadline(
  value: unknown,
  parentId?: string | null,
): asserts value is TaskDeadline | null {
  if (value === null) return;
  if (parentId)
    throw new Error("Due dates are available only for top-level tasks.");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  )
    throw new Error("Choose a valid due date.");
  const input = value as Record<string, unknown>;
  if ("date" in input && validDeadlineDate(input.date)) return;
  if (
    typeof input.at === "string" &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(
      input.at,
    ) &&
    validDeadlineDate(input.at.slice(0, 10)) &&
    Number.isFinite(Date.parse(input.at)) &&
    new Date(input.at).toISOString() === input.at
  )
    return;
  throw new Error("Choose a valid due date.");
}

const offsets = new Map<string, number[]>();
function localInstant(
  date: string,
  time: string,
  timezone: string,
): number | undefined {
  const wall = Date.parse(`${date}T${time}:00.000Z`);
  const key = `${timezone}:${date}`;
  let possible = offsets.get(key);
  if (!possible) {
    const values = new Set<number>();
    // Sample both sides of nearby transitions rather than assuming a fixed offset.
    for (let hours = -36; hours <= 36; hours += 6) {
      const stamp = wall + hours * 3600000;
      const local = deadlineLocalParts(stamp, timezone);
      values.add(Date.parse(`${local.date}T${local.time}:00.000Z`) - stamp);
    }
    possible = [...values];
    if (offsets.size >= 256) offsets.clear();
    offsets.set(key, possible);
  }
  const matches = possible
    .map((offset) => wall - offset)
    .filter((stamp) => {
      const parts = deadlineLocalParts(stamp, timezone);
      return parts.date === date && parts.time === time;
    });
  return matches.length ? Math.min(...matches) : undefined;
}
export function deadlineFromInput(
  date: string,
  time: string | null,
  timezone: string,
): TaskDeadline {
  if (!validDeadlineDate(date)) throw new Error("Choose a valid due date.");
  if (time === null) return { date };
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))
    throw new Error("Choose a valid due time.");
  const stamp = localInstant(date, time, timezone);
  if (stamp === undefined)
    throw new Error(
      "That time doesn’t exist in this timezone because the clocks change. Choose another time.",
    );
  const deadline = { at: new Date(stamp).toISOString() };
  validateDeadline(deadline);
  return deadline;
}
export function deadlineInput(
  deadline: TaskDeadline | null | undefined,
  timezone: string,
) {
  if (!deadline) return { date: "", time: "" };
  return deadline.date
    ? { date: deadline.date, time: "" }
    : deadlineLocalParts(Date.parse(deadline.at!), timezone);
}
export function deadlineDayStart(date: string, timezone: string): number {
  // Some zones skip midnight (or an entire calendar date). Use the first valid
  // local minute at or after that boundary for date-only deadlines.
  const wall = Date.parse(`${date}T00:00:00.000Z`);
  for (let minute = 0; minute <= 2880; minute++) {
    const text = new Date(wall + minute * 60000).toISOString();
    const [day, clock] = text.split("T");
    const stamp = localInstant(day, clock.slice(0, 5), timezone);
    if (stamp !== undefined) return stamp;
  }
  throw new Error("Couldn’t resolve this date in the current timezone.");
}
export function deadlineInstant(
  deadline: TaskDeadline | null | undefined,
  timezone: string,
) {
  if (!deadline) return Infinity;
  return deadline.date
    ? deadlineDayStart(shiftDate(deadline.date, 1), timezone)
    : Date.parse(deadline.at!);
}
export function deadlinePresentation(
  deadline: TaskDeadline,
  now: number,
  timezone: string,
  completed: boolean,
) {
  const local = deadlineInput(deadline, timezone);
  const today = deadlineLocalParts(now, timezone).date;
  const overdue = !completed && now >= deadlineInstant(deadline, timezone);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(local.date.slice(0, 4) !== today.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
  }).format(new Date(`${local.date}T12:00:00Z`));
  const relative =
    local.date === today
      ? "today"
      : local.date === shiftDate(today, 1)
        ? "tomorrow"
        : date;
  const time = deadline.at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(Date.parse(deadline.at))
    : "";
  return {
    overdue,
    label: `${overdue ? `Overdue · ${date}` : `Due ${relative}`}${time ? ` · ${time}` : ""}`,
  };
}
