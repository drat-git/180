import { it, expect } from "vitest";
import {
  applyAntiCommand,
  antiRecap,
  visibleAntiItems,
  logActive,
} from "./antiRotting";
import type { AntiCommand, AntiItem, AntiLog, AntiEvent } from "./model";
const date = "2026-10-10",
  at = "2026-10-10T16:00:00.000Z";
function fixture(type: "reusable" | "one-time" = "one-time") {
  let state: { items: AntiItem[]; logs: AntiLog[]; events: AntiEvent[] } = {
      items: [],
      logs: [],
      events: [],
    },
    seq = 0;
  const run = (command: Partial<AntiCommand>) => {
    state = applyAntiCommand(state, "owner", `op${++seq}`, {
      itemId: "idea",
      at,
      logicalDate: date,
      timezone: "America/New_York",
      action: "create",
      ...command,
    });
    return state;
  };
  run({ title: "Documentary", notes: "Original notes", itemType: type });
  return {
    run,
    get state() {
      return state;
    },
  };
}
it("reusable activities log once a day without completing or disappearing", () => {
  const f = fixture("reusable");
  f.run({ action: "log", logged: true });
  f.run({ action: "log", logged: true });
  f.run({ action: "complete", completed: true });
  expect(f.state.logs).toHaveLength(1);
  expect(f.state.items[0].completedAt).toBeNull();
  expect(
    visibleAntiItems(f.state.items, Date.parse(at) + 86400000),
  ).toHaveLength(1);
});
it("automatic logs disappear when completion is undone on the same day", () => {
  const f = fixture();
  f.run({ action: "complete", completed: true });
  expect(logActive(f.state.logs[0])).toBe(true);
  f.run({ action: "complete", completed: false });
  expect(logActive(f.state.logs[0])).toBe(false);
  expect(antiRecap(f.state.logs, f.state.events, date)).toEqual([]);
  expect(f.state.events).toHaveLength(2);
});
it("manual work survives completing and reopening, and recap reports worked on", () => {
  const f = fixture();
  f.run({ action: "log", logged: true });
  f.run({ action: "complete", completed: true });
  f.run({ action: "complete", completed: false });
  expect(logActive(f.state.logs[0])).toBe(true);
  expect(antiRecap(f.state.logs, f.state.events, date)[0].completed).toBe(
    false,
  );
});
it("later-day reopen and rename do not rewrite the completed-day recap", () => {
  const f = fixture();
  f.run({ action: "complete", completed: true });
  const before = antiRecap(f.state.logs, f.state.events, date);
  f.run({
    action: "edit",
    title: "Renamed",
    notes: "New notes",
    itemType: "reusable",
    at: "2026-10-11T06:00:00.000Z",
    logicalDate: "2026-10-11",
  });
  f.run({
    action: "delete",
    at: "2026-10-11T06:00:00.000Z",
    logicalDate: "2026-10-11",
  });
  expect(antiRecap(f.state.logs, f.state.events, date)).toEqual(before);
  expect(before[0]).toMatchObject({
    title: "Documentary",
    notes: "Original notes",
    completed: true,
  });
});
it("completion stays visible for exactly 12 elapsed hours and recompleting resets expiry", () => {
  const f = fixture();
  f.run({ action: "complete", completed: true });
  expect(
    visibleAntiItems(f.state.items, Date.parse(at) + 43200000 - 1),
  ).toHaveLength(1);
  expect(
    visibleAntiItems(f.state.items, Date.parse(at) + 43200000),
  ).toHaveLength(0);
  f.run({
    action: "complete",
    completed: false,
    at: "2026-10-10T18:00:00.000Z",
  });
  f.run({
    action: "complete",
    completed: true,
    at: "2026-10-10T18:00:00.000Z",
  });
  expect(
    visibleAntiItems(f.state.items, Date.parse(at) + 43200000),
  ).toHaveLength(1);
});
it("explicit daily removal leaves completion history and does not reopen", () => {
  const f = fixture();
  f.run({ action: "complete", completed: true });
  f.run({ action: "log", logged: false });
  expect(logActive(f.state.logs[0])).toBe(false);
  expect(antiRecap(f.state.logs, f.state.events, date)[0].completed).toBe(true);
  expect(f.state.items[0].completedAt).toBe(at);
});
it("deleted activities retain logs, can have today’s log removed, and cannot resurrect", () => {
  const f = fixture("reusable");
  f.run({ action: "log", logged: true });
  f.run({ action: "delete" });
  f.run({ action: "edit", title: "Changed", notes: "", itemType: "one-time" });
  expect(f.state.items[0].title).toBe("Documentary");
  expect(antiRecap(f.state.logs, f.state.events, date)).toHaveLength(1);
  f.run({ action: "log", logged: false });
  expect(antiRecap(f.state.logs, f.state.events, date)).toHaveLength(0);
});
it("invalid titles and oversized notes are rejected before changing data", () => {
  const f = fixture();
  expect(() =>
    f.run({ action: "edit", title: " ", itemType: "reusable" }),
  ).toThrow();
  expect(() =>
    f.run({
      action: "edit",
      title: "Valid",
      notes: "x".repeat(5001),
      itemType: "reusable",
    }),
  ).toThrow();
  expect(f.state.items[0].title).toBe("Documentary");
});
