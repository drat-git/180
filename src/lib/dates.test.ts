import { describe, it, expect } from "vitest";
import {
  logicalDate,
  dayNumber,
  addDays,
  canNavigate,
  needsUnlock,
  weekday,
} from "./dates";
describe("logical days", () => {
  it("moves at 2 AM, not midnight", () => {
    expect(logicalDate(new Date(2026, 9, 10, 1, 59, 59))).toBe("2026-10-09");
    expect(logicalDate(new Date(2026, 9, 10, 2))).toBe("2026-10-10");
  });
  it("numbers calendar days across daylight-saving and year boundaries", () => {
    expect(dayNumber("2026-10-09")).toBe(1);
    expect(dayNumber("2026-11-01")).toBe(24);
    expect(dayNumber("2027-01-01")).toBe(85);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("handles prelaunch, navigation, and yesterday editing", () => {
    expect(logicalDate(new Date(2026, 9, 9, 1))).toBe("2026-10-08");
    expect(canNavigate("2026-10-08", "2026-10-09")).toBe(false);
    expect(canNavigate("2026-10-10", "2026-10-09")).toBe(false);
    expect(needsUnlock("2026-10-09", "2026-10-10")).toBe(false);
    expect(needsUnlock("2026-10-09", "2026-10-11")).toBe(true);
  });
  it("uses each device’s local calendar without changing recorded dates", () => {
    const early = new Date(2026, 10, 1, 1, 30);
    expect(logicalDate(early)).toBe("2026-10-31");
    expect(logicalDate(new Date(2026, 10, 1, 2, 0))).toBe("2026-11-01");
    expect(weekday("2026-10-10")).toBe(6);
  });
});
