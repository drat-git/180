import { db, type AppDatabase } from "./db";
import {
  type AntiCommand,
  emptyData,
  createId,
  type DailyEntry,
  type EntryPatch,
  type JournalImage,
  type TaskCommand,
  type TaskTopic,
  type PendingOperation,
} from "./model";
import { applyAntiCommand } from "./antiRotting";
import { applyTaskCommand } from "./tasks";
import { logicalDate } from "./dates";
import { normalizePhoto } from "./photos";
export interface EntryRepository {
  getDay(userId: string, date: string): Promise<DailyEntry | undefined>;
  patchDay(userId: string, date: string, patch: EntryPatch): Promise<void>;
  addPhoto(userId: string, date: string, file: File): Promise<string>;
  removePhoto(userId: string, id: string): Promise<void>;
  createTask(
    userId: string,
    topic: TaskTopic,
    title: string,
    parentId?: string,
  ): Promise<string>;
  renameTask(userId: string, taskId: string, title: string): Promise<void>;
  completeTask(
    userId: string,
    taskId: string,
    complete: boolean,
  ): Promise<void>;
  deleteTask(userId: string, taskId: string): Promise<void>;
}
export class LocalRepository implements EntryRepository {
  onChange: () => void = () => {};
  private unsavedAnti = new Map<string, PendingOperation>();
  private antiWrites: Promise<unknown> = Promise.resolve();
  private unsavedTasks = new Map<string, PendingOperation>();
  private taskWrites: Promise<unknown> = Promise.resolve();
  private unsaved = new Map<string, EntryPatch>();
  hasUnsaved(userId: string) {
    return (
      [...this.unsaved.keys()].some((key) => key.startsWith(userId + "|")) ||
      [...this.unsavedTasks.values()].some((op) => op.userId === userId) ||
      [...this.unsavedAnti.values()].some((op) => op.userId === userId)
    );
  }
  unsavedFor(userId: string, date: string) {
    return this.unsaved.get(userId + "|" + date) ?? {};
  }
  async retryUnsaved(userId: string) {
    await this.flushTaskWrites(userId);
    await this.flushAntiWrites(userId);
    for (const key of [...this.unsaved.keys()])
      if (key.startsWith(userId + "|"))
        await this.patchDay(userId, key.slice(userId.length + 1), {});
  }
  constructor(public database: AppDatabase = db) {}
  getDay(userId: string, date: string) {
    return this.database.entries.get([userId, date]);
  }
  async patchDay(userId: string, date: string, patch: EntryPatch) {
    const now = new Date().toISOString();
    const key = userId + "|" + date;
    patch = { ...this.unsaved.get(key), ...patch };
    this.unsaved.set(key, patch);
    await this.database.transaction(
      "rw",
      this.database.entries,
      this.database.outbox,
      async () => {
        const entry = await this.getDay(userId, date);
        await this.database.entries.put({
          ...entry,
          userId,
          logicalDate: date,
          data: { ...emptyData(), ...entry?.data, ...patch },
          revision: entry?.revision ?? 0,
          createdAt: entry?.createdAt ?? now,
          updatedAt: now,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: date,
          kind: "entry",
          patch,
          createdAt: now,
        });
      },
    );
    const remaining = { ...this.unsaved.get(key) };
    for (const field of Object.keys(patch) as (keyof EntryPatch)[])
      if (remaining[field] === patch[field]) delete remaining[field];
    if (Object.keys(remaining).length) this.unsaved.set(key, remaining);
    else this.unsaved.delete(key);
    this.onChange();
  }
  private flushTaskWrites(userId: string) {
    const run = this.taskWrites
      .catch(() => {})
      .then(async () => {
        for (const op of this.unsavedTasks.values()) {
          if (op.userId !== userId) continue;
          await this.database.transaction(
            "rw",
            this.database.tasks,
            this.database.taskEvents,
            this.database.outbox,
            async () => {
              const before = await this.database.tasks
                .where("userId")
                .equals(userId)
                .toArray();
              const { tasks, events } = applyTaskCommand(
                before,
                userId,
                op.operationId,
                op.taskCommand!,
              );
              await this.database.tasks.bulkPut(tasks);
              await this.database.taskEvents.bulkPut(events);
              await this.database.outbox.add(op);
            },
          );
          this.unsavedTasks.delete(op.operationId);
          this.onChange();
        }
      });
    this.taskWrites = run;
    return run;
  }
  private mutateTask(
    userId: string,
    input: Omit<TaskCommand, "at" | "logicalDate" | "timezone">,
  ) {
    const now = new Date();
    const operationId = createId();
    this.unsavedTasks.set(operationId, {
      operationId,
      userId,
      logicalDate: logicalDate(now),
      kind: "task",
      createdAt: now.toISOString(),
      taskCommand: {
        ...input,
        at: now.toISOString(),
        logicalDate: logicalDate(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    return this.flushTaskWrites(userId);
  }
  async createTask(
    userId: string,
    topic: TaskTopic,
    title: string,
    parentId?: string,
  ) {
    const taskId = createId();
    await this.mutateTask(userId, {
      taskId,
      action: "create",
      topic,
      title: title.trim(),
      parentId: parentId ?? null,
    });
    return taskId;
  }
  renameTask(userId: string, taskId: string, title: string) {
    return this.mutateTask(userId, {
      taskId,
      action: "rename",
      title: title.trim(),
    });
  }
  completeTask(userId: string, taskId: string, complete: boolean) {
    return this.mutateTask(userId, {
      taskId,
      action: "complete",
      completed: complete,
    });
  }
  deleteTask(userId: string, taskId: string) {
    return this.mutateTask(userId, { taskId, action: "delete" });
  }
  private flushAntiWrites(userId: string) {
    const run = this.antiWrites
      .catch(() => {})
      .then(async () => {
        for (const op of this.unsavedAnti.values()) {
          if (op.userId !== userId) continue;
          await this.database.transaction(
            "rw",
            [
              this.database.antiItems,
              this.database.antiLogs,
              this.database.antiEvents,
              this.database.outbox,
            ],
            async () => {
              const source = {
                items: await this.database.antiItems
                  .where("userId")
                  .equals(userId)
                  .toArray(),
                logs: await this.database.antiLogs
                  .where("userId")
                  .equals(userId)
                  .toArray(),
                events: await this.database.antiEvents
                  .where("userId")
                  .equals(userId)
                  .toArray(),
              };
              const next = applyAntiCommand(
                source,
                userId,
                op.operationId,
                op.antiCommand!,
              );
              await this.database.antiItems.bulkPut(next.items);
              await this.database.antiLogs.bulkPut(next.logs);
              await this.database.antiEvents.bulkPut(next.events);
              await this.database.outbox.add(op);
            },
          );
          this.unsavedAnti.delete(op.operationId);
          this.onChange();
        }
      });
    this.antiWrites = run;
    return run;
  }
  antiOperation(
    userId: string,
    input: Omit<AntiCommand, "at" | "logicalDate" | "timezone">,
  ) {
    const now = new Date(),
      operationId = createId();
    this.unsavedAnti.set(operationId, {
      operationId,
      userId,
      logicalDate: logicalDate(now),
      kind: "anti-rotting",
      createdAt: now.toISOString(),
      antiCommand: {
        ...input,
        at: now.toISOString(),
        logicalDate: logicalDate(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    return this.flushAntiWrites(userId);
  }
  async addPhoto(userId: string, date: string, file: File) {
    if (!(
      /^(image\/(jpeg|png|webp|heic|heif))$/i.test(file.type) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
    ))
      throw new Error("Choose a JPEG, PNG, WebP, or HEIC photo.");
    if (file.size > 50 * 1024 * 1024)
      throw new Error("Choose a photo smaller than 50 MB.");
    const id = createId(),
      now = new Date().toISOString();
    if (!(await this.getDay(userId, date)))
      await this.patchDay(userId, date, {});
    const existing = await this.database.images
      .where("[userId+logicalDate]")
      .equals([userId, date])
      .toArray();
    const image: JournalImage = {
      id,
      userId,
      logicalDate: date,
      storagePath: `${userId}/${date}/${id}.jpg`,
      position: Math.max(0, ...existing.map((i) => i.position)) + 1,
      revision: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Persist the original before conversion; a crash cannot erase a selected photo.
    await this.database.transaction(
      "rw",
      this.database.images,
      this.database.blobs,
      this.database.outbox,
      async () => {
        await this.database.images.put(image);
        const type = /\.hei[cf]$/i.test(file.name) ? "image/heic" : file.type;
        await this.database.blobs.put({
          id,
          userId,
          blob: new Blob([file], { type }),
          normalized: false,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: date,
          kind: "photo-add",
          imageId: id,
          createdAt: now,
        });
      },
    );
    try {
      await this.preparePhoto(userId, id);
    } catch (error) {
      await this.database.images.update(id, {
        localError:
          error instanceof Error ? error.message : "Photo conversion failed.",
      });
    }
    this.onChange();
    return id;
  }
  async preparePhoto(userId: string, id: string) {
    const cached = await this.database.blobs.get(id);
    if (!cached || cached.userId !== userId)
      throw new Error("The local photo is missing.");
    if (cached.normalized) return cached.blob;
    const blob = await normalizePhoto(cached.blob);
    await this.database.blobs.put({ ...cached, blob, normalized: true });
    await this.database.images.update(id, { localError: undefined });
    return blob;
  }
  async removePhoto(userId: string, id: string) {
    const image = await this.database.images.get(id);
    if (!image || image.userId !== userId) return;
    const now = new Date().toISOString();
    await this.database.transaction(
      "rw",
      this.database.images,
      this.database.outbox,
      async () => {
        await this.database.images.update(id, {
          deletedAt: now,
          updatedAt: now,
          localError: undefined,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: image.logicalDate,
          kind: "photo-delete",
          imageId: id,
          createdAt: now,
        });
      },
    );
    this.onChange();
  }
}
export const repository = new LocalRepository();
