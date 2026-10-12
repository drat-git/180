import { describe, it, expect } from "vitest";
import {
  emptyData,
  reasonVisible,
  answerPatch,
  breakfastAnswerPatch,
  breakfastComplete,
  newFoodChecklist,
} from "./model";
describe("daily rules", () => {
  it("uses strict thresholds", () => {
    const d = emptyData();
    d.wakeTime = "10:00";
    expect(reasonVisible("wake", d)).toBe(false);
    d.wakeTime = "10:01";
    expect(reasonVisible("wake", d)).toBe(true);
    d.screenTimeMinutes = 210;
    expect(reasonVisible("screenTime", d)).toBe(false);
    d.screenTimeMinutes = 211;
    expect(reasonVisible("screenTime", d)).toBe(true);
    d.cannabisStatus = true;
    d.cannabisCount = 2;
    expect(reasonVisible("cannabis", d)).toBe(false);
    d.cannabisCount = 3;
    expect(reasonVisible("cannabis", d)).toBe(false);
    d.cannabisStatus = false;
    expect(reasonVisible("cannabis", d)).toBe(false);
  });
  it("toggles through all three states and preserves auxiliary data", () => {
    const d = emptyData();
    d.meal1Reason = "No groceries";
    d.meal1Description = "Pasta";
    expect(answerPatch("meal1", null, true, d)).toEqual({ meal1Status: true });
    expect(answerPatch("meal1", true, true, d)).toEqual({ meal1Status: null });
    expect(answerPatch("meal1", true, false, d)).toEqual({
      meal1Status: false,
    });
    expect(d.meal1Reason).toBe("No groceries");
    expect(d.meal1Description).toBe("Pasta");
  });
  it("initializes counters only once", () => {
    const d = emptyData();
    expect(answerPatch("cannabis", null, true, d)).toEqual({
      cannabisStatus: true,
      cannabisCount: 1,
    });
    d.cannabisCount = 4;
    expect(answerPatch("cannabis", false, true, d)).toEqual({
      cannabisStatus: true,
    });
  });
});

it("uses the Day 4 boundary and requires a fresh breakfast choice after every toggle", () => {
  expect(newFoodChecklist("2026-10-11")).toBe(false);
  expect(newFoodChecklist("2026-10-12")).toBe(true);
  const data = emptyData();
  data.amBreakfastDescription = "Eggs and toast";
  Object.assign(data, breakfastAnswerPatch(data.amBreakfast, true));
  expect(breakfastComplete(data)).toBe(false);
  data.amBreakfast.choice = "meal";
  expect(breakfastComplete(data)).toBe(true);
  Object.assign(data, breakfastAnswerPatch(data.amBreakfast, true));
  expect(data.amBreakfast).toEqual({ status: null, choice: null });
  Object.assign(data, breakfastAnswerPatch(data.amBreakfast, true));
  expect(data.amBreakfast).toEqual({ status: true, choice: null });
  Object.assign(data, breakfastAnswerPatch(data.amBreakfast, false));
  expect(data.amBreakfast).toEqual({ status: false, choice: null });
  expect(data.amBreakfastDescription).toBe("Eggs and toast");
});
