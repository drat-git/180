import { afterEach, it, expect, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
const database = new AppDatabase("180-tests");
const repo = new LocalRepository(database);
afterEach(async () => {
  await Promise.all([
    database.entries.clear(),
    database.outbox.clear(),
    database.images.clear(),
    database.blobs.clear(),
  ]);
});
it("atomically saves an answer and its durable outbox operation", async () => {
  await repo.patchDay("owner", "2026-10-09", {
    meal1Status: false,
    meal1Reason: "Groceries",
  });
  const entry = await repo.getDay("owner", "2026-10-09");
  expect(entry?.data.meal1Status).toBe(false);
  expect(await database.outbox.count()).toBe(1);
  await repo.patchDay("owner", "2026-10-09", { meal1Status: true });
  expect((await repo.getDay("owner", "2026-10-09"))?.data.meal1Reason).toBe(
    "Groceries",
  );
  expect(await repo.getDay("another-owner", "2026-10-09")).toBeUndefined();
});
it("preserves rapid updates and segregates accounts", async () => {
  await Promise.all([
    repo.patchDay("a", "2026-10-09", { journalText: "A" }),
    repo.patchDay("a", "2026-10-09", { journalText: "AB" }),
    repo.patchDay("a", "2026-10-09", { journalText: "ABC" }),
    repo.patchDay("b", "2026-10-09", { journalText: "Other" }),
  ]);
  expect((await repo.getDay("a", "2026-10-09"))?.data.journalText).toBe("ABC");
  expect((await repo.getDay("b", "2026-10-09"))?.data.journalText).toBe(
    "Other",
  );
});
it("tombstones a photo and queues removal without losing the local original", async () => {
  await database.images.add({
    id: "photo",
    userId: "owner",
    logicalDate: "2026-10-09",
    storagePath: "path",
    position: 1,
    revision: 1,
    deletedAt: null,
    createdAt: "now",
    updatedAt: "now",
  });
  await database.blobs.add({
    id: "photo",
    userId: "owner",
    blob: new Blob(["image"]),
    normalized: true,
  });
  await repo.removePhoto("other", "photo");
  expect(await database.outbox.count()).toBe(0);
  await repo.removePhoto("owner", "photo");
  expect((await database.images.get("photo"))?.deletedAt).not.toBeNull();
  expect((await database.blobs.get("photo"))?.blob).toBeDefined();
  expect((await database.outbox.toArray())[0].kind).toBe("photo-delete");
});
it("retries a failed local write without losing fields or replaying older text", async () => {
  const put = vi
    .spyOn(database.entries, "put")
    .mockRejectedValueOnce(new Error("Quota exceeded"));
  await expect(
    repo.patchDay("owner", "2026-10-09", {
      meal1Reason: "Keep this reason",
      journalText: "Earlier",
    }),
  ).rejects.toThrow("Quota exceeded");
  expect(await database.outbox.count()).toBe(0);
  expect(repo.hasUnsaved("owner")).toBe(true);
  put.mockRestore();
  await repo.patchDay("owner", "2026-10-09", { journalText: "Latest" });
  expect((await repo.getDay("owner", "2026-10-09"))?.data.meal1Reason).toBe(
    "Keep this reason",
  );
  expect((await repo.getDay("owner", "2026-10-09"))?.data.journalText).toBe(
    "Latest",
  );
  expect(repo.hasUnsaved("owner")).toBe(false);
});
