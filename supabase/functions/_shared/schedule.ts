export function validateTime(time: string, timezone: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Choose a valid reminder time.");
  new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(now: Date, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 32) formatters.clear();
    formatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
export function reminderDay(now: Date, zone: string) {
  const local = localParts(now, zone);
  if (local.minute >= 120) return local.date;
  return new Date(Date.parse(`${local.date}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}
export function nextReminder(now: Date, time: string, zone: string): string {
  validateTime(time, zone);
  const target = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const initial = localParts(now, zone);
  let previous = initial;
  // Scan chronological minutes: spring gaps use the first valid minute, fall
  // repeats use the first occurrence. No fixed 24-hour timezone arithmetic.
  for (
    let stamp = Math.floor(now.getTime() / 60000) * 60000 + 60000;
    stamp <= now.getTime() + 72 * 3600000;
    stamp += 60000
  ) {
    const current = localParts(new Date(stamp), zone);
    const alreadyPassed =
      current.date === initial.date && initial.minute >= target;
    const previousMinute =
      current.date === previous.date ? previous.minute : -1;
    if (!alreadyPassed && current.minute >= target && previousMinute < target)
      return new Date(stamp).toISOString();
    previous = current;
  }
  throw new Error("Couldn’t schedule a reminder in this timezone.");
}
export function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      [
        "push.apple.com",
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "notify.windows.com",
      ].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
