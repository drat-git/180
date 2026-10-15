import { db, type AppDatabase } from "./db";
import {
  type AntiCommand,
  emptyData,
  createId,
  type DailyEntry,
  type EntryPatch,
  type JournalImage,
  type TaskCommand,
  type TaskOptions,
  type TaskTopic,
  type PendingOperation,
} from "./model";
import { applyAntiCommand } from "./antiRotting";
import { applyTaskCommand } from "./tasks";
import { taskDailyChange, taskDailyPatch } from "./taskDaily";
import {
  clockForUser,
  isDemoUser,
  recordedDateForUser,
  timezoneForUser,
} from "./appMode";
import { normalizePhoto } from "./photos";
import type { ConfigurationPatch, ItemAnswer } from "./customizationTypes";
import {
  resolveConfiguration,
  legacyItemAnswer,
  legacyAnswerPatch,
  validateConfiguration,
  validateConfigurationTransition,
  validateItemAnswer,
} from "./customization";
import {
  configurationRevision,
  mergeAnswer,
  captureTaskLink,
  applyTaskAnswer,
} from "./customizationStore";
export interface EntryRepository {
  getDay(userId: string, date: string): Promise<DailyEntry | undefined>;
  patchDay(userId: string, date: string, patch: EntryPatch): Promise<void>;
  saveConfiguration(
    userId: string,
    patch: ConfigurationPatch,
    effectiveDate: string,
    baseRevision: number,
  ): Promise<void>;
  patchItem(
    userId: string,
    date: string,
    itemId: string,
    generation: number,
    patch: Partial<ItemAnswer>,
  ): Promise<void>;
  addPhoto(userId: string, date: string, file: File): Promise<string>;
  removePhoto(userId: string, id: string): Promise<void>;
  createTask(
    userId: string,
    topic: TaskTopic,
    title: string,
    parentId?: string,
    options?: TaskOptions,
  ): Promise<string>;
  updateTaskOptions(
    userId: string,
    taskId: string,
    options: TaskOptions,
  ): Promise<void>;
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
  // Keep failed entry and task writes in invocation order, including recovery.
  private unsavedWrites = new Map<string, PendingOperation>();
  private localWrites: Promise<unknown> = Promise.resolve();
  private unsaved = new Map<string, EntryPatch>();
  private rebasingConfiguration = new Set<string>();
  async rebaseConfigurationConflict(userId: string) {
    this.rebasingConfiguration.add(userId);
  }
  hasUnsaved(userId: string) {
    return (
      [...this.unsaved.keys()].some((key) => key.startsWith(userId + "|")) ||
      [...this.unsavedWrites.values()].some((op) => op.userId === userId) ||
      [...this.unsavedAnti.values()].some((op) => op.userId === userId)
    );
  }
  unsavedFor(userId: string, date: string) {
    return this.unsaved.get(userId + "|" + date) ?? {};
  }
  async retryUnsaved(userId: string) {
    await this.flushLocalWrites(userId);
    await this.flushAntiWrites(userId);
  }
  constructor(public database: AppDatabase = db) {}
  private async enqueue(operation: PendingOperation) {
    if (!isDemoUser(operation.userId))
      await this.database.outbox.add(operation);
  }
  discardDemoUnsaved(userId: string) {
    if (!isDemoUser(userId)) throw new Error("Only demo drafts can be reset.");
    for (const key of this.unsaved.keys())
      if (key.startsWith(userId + "|")) this.unsaved.delete(key);
    for (const [key, op] of this.unsavedWrites)
      if (op.userId === userId) this.unsavedWrites.delete(key);
    for (const [key, op] of this.unsavedAnti)
      if (op.userId === userId) this.unsavedAnti.delete(key);
  }
  getDay(userId: string, date: string) {
    return this.database.entries.get([userId, date]);
  }
  async patchDay(userId: string, date: string, patch: EntryPatch) {
    const now = clockForUser(userId).toISOString();
    const key = userId + "|" + date;
    this.unsaved.set(key, { ...this.unsaved.get(key), ...patch });
    const operationId = createId();
    this.unsavedWrites.set(operationId, {
      operationId,
      userId,
      logicalDate: date,
      kind: "entry",
      patch,
      createdAt: now,
    });
    await this.flushLocalWrites(userId);
  }
  async saveConfiguration(
    userId: string,
    patch: ConfigurationPatch,
    effectiveDate: string,
    baseRevision: number,
  ) {
    // A reviewed no-op still needs a replacement revision to retire the
    // conflicting queue safely and validate its dependent answer identities.
    if (!Object.keys(patch).length && !this.rebasingConfiguration.has(userId))
      return;
    patch = structuredClone(patch);
    const retained = await this.database.configurations
      .where("userId")
      .equals(userId)
      .toArray();
    const current = resolveConfiguration(userId, effectiveDate, retained);
    for (const changed of patch.items ?? []) {
      const previous = current.items.find((item) => item.id === changed.id);
      if (
        previous &&
        changed.generation &&
        changed.generation > previous.generation
      ) {
        const maximum = Math.max(
          previous.generation,
          ...retained
            .filter(
              (change) =>
                !change.conflict || !this.rebasingConfiguration.has(userId),
            )
            .flatMap((change) =>
              (change.patch.items ?? [])
                .filter((item) => item.id === changed.id)
                .map((item) => item.generation ?? 1),
            ),
        );
        changed.generation = Math.max(changed.generation, maximum + 1);
        Object.assign(changed, { legacyKey: null });
      }
    }
    const failed = [...this.unsavedWrites.values()].find(
      (operation) =>
        operation.userId === userId && operation.kind === "configuration",
    );
    if (failed && failed.configurationChange!.baseRevision === baseRevision) {
      failed.configurationChange!.patch = patch;
      failed.configurationChange!.effectiveDate = effectiveDate;
      failed.logicalDate = effectiveDate;
      await this.flushLocalWrites(userId);
      return;
    }
    const now = clockForUser(userId).toISOString();
    const operationId = createId();
    this.unsavedWrites.set(operationId, {
      operationId,
      userId,
      logicalDate: effectiveDate,
      kind: "configuration",
      createdAt: now,
      configurationChange: {
        id: operationId,
        operationId,
        userId,
        effectiveDate,
        baseRevision,
        sequence: baseRevision + 1,
        patch,
        createdAt: now,
      },
    });
    try {
      await this.flushLocalWrites(userId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Your checklist changed")
      )
        this.unsavedWrites.delete(operationId);
      throw error;
    }
  }
  async patchItem(
    userId: string,
    date: string,
    itemId: string,
    generation: number,
    patch: Partial<ItemAnswer>,
  ) {
    const now = clockForUser(userId).toISOString(),
      operationId = createId();
    this.unsavedWrites.set(operationId, {
      operationId,
      userId,
      logicalDate: date,
      kind: "custom-answer",
      createdAt: now,
      customAnswer: { itemId, generation, patch },
    });
    await this.flushLocalWrites(userId);
  }
  private flushLocalWrites(userId: string) {
    const run = this.localWrites
      .catch(() => {})
      .then(async () => {
        for (const op of this.unsavedWrites.values()) {
          if (op.userId !== userId) continue;
          await this.database.transaction(
            "rw",
            [
              this.database.tasks,
              this.database.taskEvents,
              this.database.entries,
              this.database.outbox,
              this.database.configurations,
              this.database.customAnswers,
            ],
            async () => {
              if (op.kind === "configuration") {
                if (this.rebasingConfiguration.has(userId)) {
                  const pending = await this.database.outbox
                    .where("userId")
                    .equals(userId)
                    .sortBy("id");
                  const conflicting = pending.filter(
                    (operation) => operation.kind === "configuration",
                  );
                  if (conflicting.length) {
                    op.id = conflicting[0].id;
                    for (const operation of conflicting) {
                      await this.database.configurations.delete(
                        operation.operationId,
                      );
                      await this.database.outbox.delete(operation.id!);
                    }
                    const accepted = await this.database.configurations
                      .where("userId")
                      .equals(userId)
                      .toArray();
                    const candidate = [...accepted, op.configurationChange!];
                    for (const dependent of pending.filter(
                      (operation) => operation.id! > op.id!,
                    )) {
                      if (dependent.taskCommand?.checklistLink) {
                        const saved = dependent.taskCommand.checklistLink;
                        const next = captureTaskLink(
                          userId,
                          dependent.logicalDate,
                          saved.listId,
                          candidate,
                        );
                        if (
                          !next ||
                          next.itemId !== saved.itemId ||
                          next.generation !== saved.generation
                        )
                          throw new Error(
                            "This draft has task completions waiting to sync. Keep their original connected question and apply it today before changing the connection.",
                          );
                      }
                      if (
                        dependent.kind === "custom-answer" &&
                        dependent.customAnswer
                      ) {
                        const answer = dependent.customAnswer;
                        const snapshots = [
                          candidate,
                          ...accepted.map((change) =>
                            accepted.filter(
                              (other) => other.sequence <= change.sequence,
                            ),
                          ),
                        ];
                        if (
                          !snapshots.some((changes) =>
                            resolveConfiguration(
                              userId,
                              dependent.logicalDate,
                              changes,
                            ).items.some(
                              (item) =>
                                item.id === answer.itemId &&
                                item.generation === answer.generation,
                            ),
                          )
                        )
                          throw new Error(
                            "This draft has answers waiting to sync. Keep their original item and input type until those answers have synced.",
                          );
                      }
                    }
                    // Preserve captured item/list identity, changing only the reviewed revision reference.
                    for (const operation of pending)
                      if (
                        operation.kind === "task" &&
                        operation.id! > op.id! &&
                        operation.taskCommand?.checklistLink
                      ) {
                        operation.taskCommand.checklistLink.configurationRevision =
                          op.configurationChange!.sequence;
                        await this.database.outbox.put(operation);
                      }
                  }
                }
                const changes = await this.database.configurations
                  .where("userId")
                  .equals(userId)
                  .toArray();
                if (
                  configurationRevision(changes) !==
                  op.configurationChange!.baseRevision
                )
                  throw new Error(
                    "Your checklist changed while this editor was open. Your draft is retained; reopen the editor to review it.",
                  );
                const before = resolveConfiguration(
                  userId,
                  op.logicalDate,
                  changes,
                );
                const next = resolveConfiguration(userId, op.logicalDate, [
                  ...changes,
                  op.configurationChange!,
                ]);
                const errors = [
                  ...validateConfiguration(next),
                  ...validateConfigurationTransition(before, next),
                ];
                // A today edit must also remain valid when already scheduled
                // changes become active, matching the server's dated checks.
                for (const date of new Set(
                  changes
                    .filter(
                      (change) =>
                        !change.conflict &&
                        change.effectiveDate > op.logicalDate,
                    )
                    .map((change) => change.effectiveDate),
                ))
                  errors.push(
                    ...validateConfiguration(
                      resolveConfiguration(userId, date, [
                        ...changes,
                        op.configurationChange!,
                      ]),
                    ).map((message) => `${date}: ${message}`),
                  );
                if (errors.length) throw new Error(errors[0]);
                await this.database.configurations.put(op.configurationChange!);
              }
              if (op.kind === "custom-answer") {
                const {
                  itemId,
                  generation,
                  patch: answerPatch,
                } = op.customAnswer!;
                const existing = await this.database.customAnswers.get([
                  userId,
                  op.logicalDate,
                  itemId,
                  generation,
                ]);
                const changes = await this.database.configurations
                  .where("userId")
                  .equals(userId)
                  .toArray();
                const item = resolveConfiguration(
                  userId,
                  op.logicalDate,
                  changes,
                ).items.find(
                  (item) =>
                    item.id === itemId && item.generation === generation,
                );
                if (!item)
                  throw new Error(
                    "This version of the checklist item is no longer active. Your answer has not been discarded.",
                  );
                const entry = await this.getDay(userId, op.logicalDate);
                const baseline = legacyItemAnswer(
                  item,
                  entry?.data ?? emptyData(),
                );
                const defaults = Object.fromEntries(
                  Object.entries(baseline.fields).filter(
                    ([key]) => existing?.value.fields[key] === undefined,
                  ),
                );
                if (Object.keys(defaults).length)
                  answerPatch.fields = { ...defaults, ...answerPatch.fields };
                const value = mergeAnswer(
                  existing?.value ?? baseline,
                  answerPatch,
                );
                const errors = validateItemAnswer(item, value);
                if (errors.length) throw new Error(errors[0]);
                await this.database.customAnswers.put({
                  userId,
                  logicalDate: op.logicalDate,
                  itemId,
                  generation,
                  value,
                  revision: existing?.revision ?? 0,
                  createdAt: existing?.createdAt ?? op.createdAt,
                  updatedAt: op.createdAt,
                });
                const legacyPatch = legacyAnswerPatch(item, value);
                if (Object.keys(legacyPatch).length)
                  await this.database.entries.put({
                    userId,
                    logicalDate: op.logicalDate,
                    data: { ...emptyData(), ...entry?.data, ...legacyPatch },
                    revision: entry?.revision ?? 0,
                    createdAt: entry?.createdAt ?? op.createdAt,
                    updatedAt: op.createdAt,
                  });
              }
              let patch = op.patch;
              if (op.kind === "task") {
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
                op.taskDailyChange = taskDailyChange(
                  tasks,
                  events,
                  op.taskCommand!,
                );
                await this.database.tasks.bulkPut(tasks);
                await this.database.taskEvents.bulkPut(events);
                const explicit = events.find(
                  (event) => event.taskId === op.taskCommand!.taskId,
                );
                const parent = explicit
                  ? tasks.find(
                      (task) =>
                        task.id === (explicit.parentId ?? explicit.taskId),
                    )
                  : undefined;
                if (explicit && parent)
                  op.customTaskChange = {
                    parent: { taskId: parent.id, title: parent.title },
                    ...(explicit.parentId
                      ? {
                          child: {
                            taskId: explicit.taskId,
                            title: explicit.title,
                          },
                        }
                      : {}),
                    completed: explicit.type === "completed",
                  };
                await applyTaskAnswer(
                  this.database,
                  userId,
                  op.logicalDate,
                  op.operationId,
                  op.taskCommand!,
                  tasks,
                  events,
                  op.createdAt,
                  op.customTaskChange,
                );
              }
              if (patch || op.taskDailyChange) {
                const entry = await this.getDay(userId, op.logicalDate);
                const data = { ...emptyData(), ...entry?.data };
                patch ??= taskDailyPatch(
                  data,
                  op.taskDailyChange!,
                  op.operationId,
                );
                if (op.kind === "entry" || Object.keys(patch).length)
                  await this.database.entries.put({
                    userId,
                    logicalDate: op.logicalDate,
                    data: { ...data, ...patch },
                    revision: entry?.revision ?? 0,
                    createdAt: entry?.createdAt ?? op.createdAt,
                    updatedAt: op.createdAt,
                  });
              }
              await this.enqueue(op);
            },
          );
          this.unsavedWrites.delete(op.operationId);
          if (op.kind === "configuration")
            this.rebasingConfiguration.delete(userId);
          if (op.kind === "entry") {
            const key = userId + "|" + op.logicalDate;
            const remaining = { ...this.unsaved.get(key) };
            for (const field of Object.keys(op.patch!) as (keyof EntryPatch)[])
              if (remaining[field] === op.patch![field])
                delete remaining[field];
            if (Object.keys(remaining).length) this.unsaved.set(key, remaining);
            else this.unsaved.delete(key);
          }
          this.onChange();
        }
      });
    this.localWrites = run;
    return run;
  }
  private async mutateTask(
    userId: string,
    input: Omit<TaskCommand, "at" | "logicalDate" | "timezone">,
  ) {
    const now = clockForUser(userId);
    const operationId = createId();
    if (input.action === "complete") {
      const task = await this.database.tasks.get(input.taskId);
      const changes = await this.database.configurations
        .where("userId")
        .equals(userId)
        .toArray();
      input.checklistLink = task
        ? captureTaskLink(
            userId,
            recordedDateForUser(userId, now),
            task.topic,
            changes,
          )
        : null;
      input.recordDaily =
        !!input.checklistLink &&
        input.checklistLink.generation === 1 &&
        (input.checklistLink.itemId === "schoolTasks" ||
          input.checklistLink.itemId === "careerTasks");
    }
    this.unsavedWrites.set(operationId, {
      operationId,
      userId,
      logicalDate: recordedDateForUser(userId, now),
      kind: "task",
      createdAt: now.toISOString(),
      taskCommand: {
        ...input,
        at: now.toISOString(),
        logicalDate: recordedDateForUser(userId, now),
        timezone: timezoneForUser(userId),
      },
    });
    return this.flushLocalWrites(userId);
  }
  async createTask(
    userId: string,
    topic: TaskTopic,
    title: string,
    parentId?: string,
    options: TaskOptions = {},
  ) {
    const taskId = createId();
    await this.mutateTask(userId, {
      taskId,
      action: "create",
      ...options,
      topic,
      title: title.trim(),
      parentId: parentId ?? null,
    });
    return taskId;
  }
  updateTaskOptions(userId: string, taskId: string, options: TaskOptions) {
    return this.mutateTask(userId, { taskId, action: "options", ...options });
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
      recordDaily: true,
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
              await this.enqueue(op);
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
    const now = clockForUser(userId),
      operationId = createId();
    this.unsavedAnti.set(operationId, {
      operationId,
      userId,
      logicalDate: recordedDateForUser(userId, now),
      kind: "anti-rotting",
      createdAt: now.toISOString(),
      antiCommand: {
        ...input,
        at: now.toISOString(),
        logicalDate: recordedDateForUser(userId, now),
        timezone: timezoneForUser(userId),
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
      now = clockForUser(userId).toISOString();
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
        await this.enqueue({
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
    const now = clockForUser(userId).toISOString();
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
        await this.enqueue({
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
