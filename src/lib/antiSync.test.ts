import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Dexie from "dexie";
import { db, AppDatabase } from "./db";
import { repository, LocalRepository } from "./repository";
import { applyAntiCommand } from "./antiRotting";
import type { AntiCommand, AntiItem, AntiLog, AntiEvent } from "./model";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: mock }));
import { pushAnti, pullAnti, mergeAnti } from "./antiSync";
let remote: { items: AntiItem[]; logs: AntiLog[]; events: AntiEvent[] };
let receipts: Set<string>;
let fail: boolean;
beforeEach(async () => {
  await Promise.all([
    db.antiItems.clear(),
    db.antiLogs.clear(),
    db.antiEvents.clear(),
    db.outbox.clear(),
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
  remote = { items: [], logs: [], events: [] };
  receipts = new Set();
  fail = false;
  mock.rpc.mockImplementation(
    async (
      _name: string,
      args: { p_operation: string; p_command: AntiCommand },
    ) => {
      if (!receipts.has(args.p_operation)) {
        remote = applyAntiCommand(
          remote,
          "owner",
          args.p_operation,
          args.p_command,
        );
        receipts.add(args.p_operation);
      }
      if (fail) {
        fail = false;
        throw new Error("Lost acknowledgement");
      }
      return { data: structuredClone(remote), error: null };
    },
  );
  mock.from.mockImplementation((table: string) => {
    let start = 0,
      end = 499;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (s: number, e: number) => {
        start = s;
        end = e;
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: (table === "anti_rotting_items"
            ? remote.items
            : table === "anti_rotting_logs"
              ? remote.logs
              : remote.events
          )
            .slice(start, end + 1)
            .map((data) => ({ data })),
          error: null,
        }).then(resolve),
    };
    return builder;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function flush() {
  for (const op of await db.outbox.toArray()) await pushAnti("owner", op);
}
it("retries a lost acknowledgement without duplicating daily logs or completion events", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Book",
    notes: "",
    itemType: "one-time",
  });
  await flush();
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "complete",
    completed: true,
  });
  const op = (await db.outbox.toArray())[0];
  fail = true;
  await expect(pushAnti("owner", op)).rejects.toThrow("Lost acknowledgement");
  await pushAnti("owner", op);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.antiLogs.count()).toBe(1);
  expect(await db.antiEvents.count()).toBe(1);
});
it("remote refresh preserves pending edits and a deletion dominates stale edits", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Book",
    notes: "",
    itemType: "reusable",
  });
  await flush();
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "edit",
    title: "New book",
    notes: "",
    itemType: "reusable",
  });
  await pullAnti("owner");
  expect((await db.antiItems.get("idea"))!.title).toBe("New book");
  remote.items[0].deletedAt = "2026-10-10T17:00:00Z";
  await pullAnti("owner");
  expect((await db.antiItems.get("idea"))!.deletedAt).not.toBeNull();
  await flush();
  expect(await db.outbox.count()).toBe(0);
});
it("two devices logging the same item/day converge on one record", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Basketball",
    notes: "",
    itemType: "reusable",
  });
  await flush();
  remote = applyAntiCommand(remote, "owner", "other-device", {
    itemId: "idea",
    action: "log",
    logged: true,
    at: "2026-10-10T16:00:00Z",
    logicalDate: "2026-10-10",
    timezone: "America/New_York",
  });
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "log",
    logged: true,
  });
  await flush();
  await pullAnti("owner");
  expect(await db.antiLogs.count()).toBe(1);
});
it("failed local writes remain retryable without partially applying completion", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Book",
    notes: "",
    itemType: "one-time",
  });
  await flush();
  const failure = vi
    .spyOn(db.outbox, "add")
    .mockRejectedValueOnce(new Error("Disk full"));
  await expect(
    repository.antiOperation("owner", {
      itemId: "idea",
      action: "complete",
      completed: true,
    }),
  ).rejects.toThrow("Disk full");
  expect((await db.antiItems.get("idea"))!.completedAt).toBeNull();
  expect(await db.antiLogs.count()).toBe(0);
  expect(repository.hasUnsaved("owner")).toBe(true);
  failure.mockRestore();
  await repository.retryUnsaved("owner");
  expect((await db.antiItems.get("idea"))!.completedAt).not.toBeNull();
  expect(repository.hasUnsaved("owner")).toBe(false);
});
it("history pulls paginate beyond 500 rows", async () => {
  remote.items = Array.from({ length: 501 }, (_, i) => ({
    id: String(i),
    userId: "owner",
    title: "Idea",
    notes: "",
    itemType: "reusable" as const,
    completedAt: null,
    completionOperationId: null,
    deletedAt: null,
    revision: 0,
    createdAt: "2026-10-10T16:00:00Z",
    updatedAt: "2026-10-10T16:00:00Z",
  }));
  await pullAnti("owner");
  expect(await db.antiItems.count()).toBe(501);
});
it("upgrades a version 2 database without losing existing records or queued writes", async () => {
  const name = "anti-upgrade";
  const old = new Dexie(name);
  old.version(2).stores({
    tasks: "id,userId",
    entries: "[userId+logicalDate],userId",
    outbox: "++id,userId,[userId+logicalDate]",
  });
  await old
    .table("tasks")
    .put({ id: "existing", userId: "owner", title: "Keep" });
  await old
    .table("outbox")
    .add({ userId: "owner", logicalDate: "2026-10-10", kind: "task" });
  old.close();
  const next = new AppDatabase(name);
  await next.open();
  expect(await next.tasks.count()).toBe(1);
  expect(await next.outbox.count()).toBe(1);
  await new LocalRepository(next).antiOperation("owner", {
    itemId: "new",
    action: "create",
    title: "Walk",
    notes: "",
    itemType: "reusable",
  });
  expect(await next.antiItems.count()).toBe(1);
  next.close();
  await Dexie.delete(name);
});
it("pending completion overlays remote state with a single event", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Book",
    notes: "",
    itemType: "one-time",
  });
  await flush();
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "complete",
    completed: true,
  });
  await mergeAnti("owner", remote);
  expect(await db.antiEvents.count()).toBe(1);
  expect((await db.antiLogs.toArray())[0].completionOperationId).not.toBeNull();
});

it("a remotely deleted item rejects a speculative local log without leaving phantom history", async () => {
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "create",
    title: "Walk",
    notes: "",
    itemType: "reusable",
  });
  await flush();
  await repository.antiOperation("owner", {
    itemId: "idea",
    action: "log",
    logged: true,
  });
  remote.items[0].deletedAt = "2026-10-10T17:00:00Z";
  await flush();
  expect(await db.antiLogs.count()).toBe(0);
  expect((await db.antiItems.get("idea"))!.deletedAt).not.toBeNull();
});
