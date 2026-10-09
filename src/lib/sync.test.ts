import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { db } from "./db";
import { repository } from "./repository";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getSession: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  today: "2026-10-09",
}));
vi.mock("./dates", () => ({ logicalDate: () => mock.today }));
vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: mock.getSession },
    rpc: mock.rpc,
    from: mock.from,
    storage: {
      from: () => ({
        upload: mock.upload,
        remove: mock.remove,
        download: mock.download,
      }),
    },
  },
}));
import { SyncEngine } from "./sync";
type Remote = {
  user_id: string;
  logical_date: string;
  data: Record<string, unknown>;
  revision: number;
  created_at: string;
  updated_at: string;
};
let remote: Remote;
let receipts: Set<string>;
let failAfterCommit: boolean;
let engines: SyncEngine[] = [];
beforeEach(async () => {
  await Promise.all([
    db.entries.clear(),
    db.images.clear(),
    db.blobs.clear(),
    db.outbox.clear(),
  ]);
  vi.clearAllMocks();
  mock.today = "2026-10-09";
  remote = {
    user_id: "owner",
    logical_date: "2026-10-09",
    data: { meal1Status: false, meal1Reason: "Device B groceries" },
    revision: 1,
    created_at: "2026-10-09T12:00:00Z",
    updated_at: "2026-10-09T12:00:00Z",
  };
  receipts = new Set();
  failAfterCommit = false;
  mock.getSession.mockResolvedValue({
    data: { session: { user: { id: "owner" } } },
    error: null,
  });
  mock.rpc.mockImplementation(
    async (
      _name: string,
      args: { p_operation: string; p_patch: Record<string, unknown> },
    ) => {
      if (!receipts.has(args.p_operation)) {
        Object.assign(remote.data, args.p_patch);
        remote.revision++;
        receipts.add(args.p_operation);
      }
      if (failAfterCommit) {
        failAfterCommit = false;
        throw new Error("Connection interrupted after commit");
      }
      return { data: structuredClone(remote), error: null };
    },
  );
  mock.from.mockImplementation((table: string) => {
    let columns = "*";
    const builder = {
      select: (value: string) => {
        columns = value;
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "journal_images"
              ? []
              : columns === "*"
                ? [structuredClone(remote)]
                : [
                    {
                      logical_date: remote.logical_date,
                      revision: remote.revision,
                    },
                  ],
          error: null,
        }).then(resolve),
    };
    return builder;
  });
});
afterEach(() => {
  for (const engine of engines) engine.stop();
  engines = [];
});
function engine() {
  const value = new SyncEngine("owner");
  engines.push(value);
  return value;
}
it("merges offline local fields with another device’s existing fields", async () => {
  await repository.patchDay("owner", "2026-10-09", {
    journalText: "Device A journal",
  });
  await engine().run();
  const data = (await db.entries.get(["owner", "2026-10-09"]))!.data;
  expect(data.journalText).toBe("Device A journal");
  expect(data.meal1Status).toBe(false);
  expect(data.meal1Reason).toBe("Device B groceries");
  expect(await db.outbox.count()).toBe(0);
});
it("a lost acknowledgement retries once without overwriting a later remote edit", async () => {
  await repository.patchDay("owner", "2026-10-09", {
    journalText: "Earlier offline journal",
  });
  failAfterCommit = true;
  const worker = engine();
  await worker.run();
  expect(worker.state).toBe("error");
  expect(await db.outbox.count()).toBe(1);
  remote.data.journalText = "Later remote journal";
  remote.revision++;
  const revision = remote.revision;
  await worker.run();
  expect(remote.revision).toBe(revision);
  expect(
    (await db.entries.get(["owner", "2026-10-09"]))!.data.journalText,
  ).toBe("Later remote journal");
  expect(await db.outbox.count()).toBe(0);
  expect(worker.state).toBe("synced");
});
it("keeps new local typing over an older in-flight server acknowledgement", async () => {
  await repository.patchDay("owner", "2026-10-09", { journalText: "First" });
  let release!: (value: unknown) => void;
  mock.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const worker = engine();
  const sync = worker.run();
  await vi.waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(1));
  await repository.patchDay("owner", "2026-10-09", {
    journalText: "First plus more",
  });
  release({
    data: {
      ...remote,
      data: { ...remote.data, journalText: "First" },
      revision: 2,
    },
    error: null,
  });
  await sync;
  expect(
    (await db.entries.get(["owner", "2026-10-09"]))!.data.journalText,
  ).toBe("First plus more");
  expect(await db.outbox.count()).toBe(1);
  await worker.run();
  expect(await db.outbox.count()).toBe(0);
  expect(remote.data.journalText).toBe("First plus more");
});
it("expired authentication preserves the outbox and pauses sync", async () => {
  await repository.patchDay("owner", "2026-10-09", { liftedStatus: true });
  mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  const worker = engine();
  await worker.run();
  expect(worker.state).toBe("auth");
  expect(await db.outbox.count()).toBe(1);
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(
    (await db.entries.get(["owner", "2026-10-09"]))!.data.liftedStatus,
  ).toBe(true);
});
it("never uploads another account’s pending data", async () => {
  await repository.patchDay("other", "2026-10-09", {
    journalText: "Other account",
  });
  await engine().run();
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(await db.outbox.count()).toBe(1);
});
it("keeps temporarily future travel edits queued while syncing accessible dates", async () => {
  await repository.patchDay("owner", "2026-10-10", {
    journalText: "Recorded before traveling west",
  });
  await repository.patchDay("owner", "2026-10-09", { liftedStatus: true });
  await engine().run();
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.rpc.mock.calls[0][1].p_date).toBe("2026-10-09");
  const pending = await db.outbox.toArray();
  expect(pending).toHaveLength(1);
  expect(pending[0].logicalDate).toBe("2026-10-10");
  expect(
    (await db.entries.get(["owner", "2026-10-10"]))!.data.journalText,
  ).toBe("Recorded before traveling west");
});
it("honors a remote photo deletion during upload retry and retries object cleanup", async () => {
  const id = "remote-deleted-photo";
  const path = `owner/2026-10-09/${id}.jpg`;
  const now = "2026-10-09T12:00:00Z";
  await db.images.put({
    id,
    userId: "owner",
    logicalDate: "2026-10-09",
    storagePath: path,
    position: 1,
    revision: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.blobs.put({
    id,
    userId: "owner",
    blob: new Blob(["photo"]),
    normalized: true,
  });
  await db.outbox.add({
    operationId: "upload-operation",
    userId: "owner",
    logicalDate: "2026-10-09",
    kind: "photo-add",
    imageId: id,
    createdAt: now,
  });
  mock.upload.mockResolvedValue({ error: null });
  mock.rpc.mockResolvedValue({
    error: null,
    data: {
      id,
      user_id: "owner",
      logical_date: "2026-10-09",
      storage_path: path,
      position: 1,
      revision: 3,
      deleted_at: now,
      created_at: now,
      updated_at: now,
    },
  });
  mock.remove
    .mockResolvedValueOnce({ error: new Error("Interrupted cleanup") })
    .mockResolvedValue({ error: null });
  const worker = engine();
  await worker.run();
  expect(worker.state).toBe("error");
  expect(await db.outbox.count()).toBe(1);
  await worker.run();
  expect(mock.remove).toHaveBeenLastCalledWith([path]);
  expect((await db.images.get(id))!.deletedAt).toBe(now);
  expect(await db.blobs.get(id)).toBeUndefined();
  expect(await db.outbox.count()).toBe(0);
});
