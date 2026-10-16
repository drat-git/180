import { afterEach, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { AppDatabase } from "./db";
import {
  accountProfileKey,
  emptyConfiguration,
  legacyAccountProfile,
  registerAccountProfile,
  type AccountProfile,
} from "./accountProfile";
import { defaultConfiguration, resolveConfiguration } from "./customization";
import { modeForUser, recordedDateForUser, todayForUser } from "./appMode";
import { canNavigate, dayNumber } from "./dates";
import { starterTemplates } from "./starters";
import { LocalRepository } from "./repository";

const profile = (
  userId = "new-user",
  startDate = "2026-11-01",
): AccountProfile => ({
  userId,
  createdAt: "2026-11-01T06:00:00Z",
  signupTimezone: "America/New_York",
  startDate,
  legacy: false,
  onboardingCompletedAt: "2026-11-03T12:00:00Z",
  starterId: "student",
  starterVersion: 1,
  initialConfiguration: structuredClone(starterTemplates[1].configuration),
});
afterEach(() => vi.useRealTimers());
it("never supplies the personal baseline to an unknown or different account", () => {
  registerAccountProfile(legacyAccountProfile("owner"));
  registerAccountProfile(profile());
  expect(
    defaultConfiguration("owner", "2026-11-01").items.some(
      (item) => item.id === "wake",
    ),
  ).toBe(true);
  expect(defaultConfiguration("new-user", "2026-11-01")).toEqual(
    starterTemplates[1].configuration,
  );
  expect(defaultConfiguration("another", "2026-11-01")).toEqual(
    emptyConfiguration(),
  );
  const future = resolveConfiguration("new-user", "2026-11-04", [
    {
      id: "edit",
      operationId: "edit",
      userId: "new-user",
      sequence: 1,
      baseRevision: 0,
      effectiveDate: "2026-11-04",
      createdAt: "now",
      patch: { items: [{ id: "starter-move", label: "Go for a run" }] },
    },
  ]);
  expect(future.items.find((item) => item.id === "starter-move")?.label).toBe(
    "Go for a run",
  );
  expect(
    defaultConfiguration("new-user", "2026-11-01").items.find(
      (item) => item.id === "starter-move",
    )?.label,
  ).toBe("Moved my body");
});
it("keeps account creation as Day 1 across delayed setup, skipped days and the 2 AM boundary", () => {
  registerAccountProfile(profile());
  const start = modeForUser("new-user").startDate;
  expect(recordedDateForUser("new-user", new Date(2026, 10, 2, 1, 59))).toBe(
    "2026-11-01",
  );
  expect(recordedDateForUser("new-user", new Date(2026, 10, 2, 2))).toBe(
    "2026-11-02",
  );
  expect(dayNumber("2026-11-03", start)).toBe(3);
  expect(dayNumber("2026-12-01", start)).toBe(31);
  expect(canNavigate("2026-10-31", "2026-11-03", start)).toBe(false);
});
it("clamps rendering and captured operations to Day 1 when travel moves local time before the anchor", async () => {
  const current = profile("traveler", "2026-11-03");
  registerAccountProfile(current);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 2, 23));
  expect(todayForUser(current.userId)).toBe(current.startDate);
  const db = new AppDatabase(`180-profile-capture-${crypto.randomUUID()}`);
  try {
    const repo = new LocalRepository(db);
    const id = await repo.createTask(
      current.userId,
      "starter-school",
      "Write notes",
    );
    await repo.completeTask(current.userId, id, true);
    const operations = await db.outbox.toArray();
    expect(
      operations
        .filter((op) => op.kind === "task")
        .every((op) => op.taskCommand?.logicalDate === current.startDate),
    ).toBe(true);
    expect(
      await db.customAnswers.where("userId").equals(current.userId).count(),
    ).toBe(1);
  } finally {
    await db.delete();
  }
});
it("upgrades the pre-public cache without modifying entries, operation IDs or unsent edits", async () => {
  const name = `180-profile-upgrade-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old
    .version(4)
    .stores({
      entries: "[userId+logicalDate],userId",
      images: "id,[userId+logicalDate],userId",
      blobs: "id,userId",
      outbox: "++id,userId,[userId+logicalDate]",
      meta: "key",
      tasks: "id,userId,[userId+topic],parentId",
      taskEvents: "id,userId,[userId+taskId],[userId+logicalDate],operationId",
      antiItems: "id,userId",
      antiLogs: "id,userId,[userId+logicalDate],[userId+itemId]",
      antiEvents: "id,userId,[userId+logicalDate],operationId",
      configurations: "id,userId,[userId+effectiveDate],sequence",
      customAnswers:
        "[userId+logicalDate+itemId+generation],userId,[userId+logicalDate]",
    });
  const entry = {
    userId: "old-owner",
    logicalDate: "2026-10-09",
    data: { journalText: "keep" },
  };
  const operation = {
    id: 41,
    userId: "old-owner",
    operationId: "receipt-unchanged",
    kind: "entry",
    patch: { journalText: "offline" },
  };
  await old
    .table("meta")
    .put({
      key: "active-account",
      value: JSON.stringify({ id: "old-owner", email: "owner@example.test" }),
    });
  await old.table("entries").put(entry);
  await old.table("outbox").put(operation);
  old.close();
  const upgraded = new AppDatabase(name);
  try {
    const saved = await upgraded.meta.get(accountProfileKey("old-owner"));
    expect(JSON.parse(saved!.value)).toMatchObject({
      legacy: true,
      startDate: "2026-10-09",
      userId: "old-owner",
    });
    expect(await upgraded.entries.toArray()).toEqual([entry]);
    expect(await upgraded.outbox.toArray()).toEqual([operation]);
  } finally {
    await upgraded.delete();
  }
});
