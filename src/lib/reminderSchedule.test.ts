import { expect, it } from "vitest";
import {
  nextReminder,
  reminderDay,
  validateTime,
  validEndpoint,
} from "../../supabase/functions/_shared/schedule";
it("schedules a future 9 PM in the phone timezone, without catch-up or fixed UTC offset", () => {
  expect(
    nextReminder(new Date("2026-10-12T16:00:00Z"), "21:00", "America/New_York"),
  ).toBe("2026-10-13T01:00:00.000Z");
  expect(
    nextReminder(new Date("2026-10-13T02:00:00Z"), "21:00", "America/New_York"),
  ).toBe("2026-10-14T01:00:00.000Z");
  expect(
    nextReminder(new Date("2026-11-02T16:00:00Z"), "21:00", "America/New_York"),
  ).toBe("2026-11-03T02:00:00.000Z");
});
it("handles DST gaps, repeated times, the 2 AM boundary and timezone changes", () => {
  expect(
    nextReminder(new Date("2027-03-14T05:00:00Z"), "02:30", "America/New_York"),
  ).toBe("2027-03-14T07:00:00.000Z");
  expect(
    nextReminder(new Date("2026-11-01T04:00:00Z"), "01:30", "America/New_York"),
  ).toBe("2026-11-01T05:30:00.000Z");
  expect(
    reminderDay(new Date("2026-10-13T05:30:00Z"), "America/New_York"),
  ).toBe("2026-10-12");
  expect(
    reminderDay(new Date("2026-10-13T06:00:00Z"), "America/New_York"),
  ).toBe("2026-10-13");
  expect(
    nextReminder(
      new Date("2026-10-12T16:00:00Z"),
      "21:00",
      "America/Los_Angeles",
    ),
  ).toBe("2026-10-13T04:00:00.000Z");
});
it("rejects malformed times and zones and untrusted push endpoints", () => {
  expect(() => validateTime("25:00", "America/New_York")).toThrow();
  expect(() => validateTime("21:00", "Not/A/Zone")).toThrow();
  for (const url of [
    "http://push.apple.com/abc",
    "https://localhost/abc",
    "https://push.apple.com.evil.com/abc",
    "https://127.0.0.1/abc",
    "https://user:pass@push.apple.com/abc",
    "https://push.apple.com:8080/abc",
  ])
    expect(validEndpoint(url)).toBe(false);
  expect(validEndpoint("https://web.push.apple.com/abc")).toBe(true);
  expect(validEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
});
