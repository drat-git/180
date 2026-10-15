import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./db";
import { LocalRepository } from "./repository";
import { configurationFor } from "./customizationStore";
import { resolveConfiguration } from "./customization";
import { seedDemo } from "./demo";
import { createId, type PendingOperation } from "./model";
import type { ConfigurationPatch } from "./customizationTypes";

const owner = "owner-customization-tests";
const today = "2026-10-15";
let database: AppDatabase;
let secondDatabase: AppDatabase | undefined;
let repository: LocalRepository;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
  database = new AppDatabase(`180-customization-repository-${createId()}`);
  repository = new LocalRepository(database);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  secondDatabase?.close();
  secondDatabase = undefined;
  await database.delete();
});

const answer = (itemId: string, generation = 1, userId = owner, date = today) =>
  database.customAnswers.get([userId, date, itemId, generation]);
const changes = (userId = owner) =>
  database.configurations.where("userId").equals(userId).toArray();
const customListPatch = (): ConfigurationPatch => ({
  lists: [{ id: "writing", title: "Writing", icon: "book", order: 3 }],
  items: [
    {
      id: "writing-work",
      blockId: "career",
      label: "Worked on writing tasks?",
      kind: "tasks",
      generation: 1,
      order: 4,
      listId: "writing",
      visibility: "relevant",
      completion: { op: "equals", field: "value", value: true },
      followups: [],
    },
  ],
});

describe("customization writes through the real local repository", () => {
  it("rejects a today connection that would collide with a scheduled future question", async () => {
    const patch = customListPatch();
    await repository.saveConfiguration(owner, { lists: patch.lists }, today, 0);
    await repository.saveConfiguration(
      owner,
      { items: patch.items },
      "2026-10-16",
      1,
    );
    await expect(
      repository.saveConfiguration(
        owner,
        { items: [{ ...patch.items![0], id: "writing-today" }] },
        today,
        2,
      ),
    ).rejects.toThrow(/2026-10-16:.*(connected|linked|question|list)/i);
    expect(await database.configurations.count()).toBe(2);
    expect(await database.outbox.count()).toBe(2);
    expect(
      resolveConfiguration(owner, "2026-10-16", await changes()).items.filter(
        (item) => item.listId === "writing" && !item.deleted,
      ),
    ).toHaveLength(1);
  });

  it("preserves unrelated today edits beside an earlier scheduled tomorrow field patch", async () => {
    await repository.saveConfiguration(
      owner,
      { items: [{ id: "wake", label: "Wake early" }] },
      today,
      0,
    );
    await repository.saveConfiguration(
      owner,
      {
        items: [
          {
            id: "wake",
            completion: {
              op: "compare",
              field: "value",
              operator: "lte",
              value: 540,
            },
          },
        ],
      },
      "2026-10-16",
      1,
    );
    await repository.saveConfiguration(
      owner,
      { items: [{ id: "wake", helper: "Open the curtains" }] },
      today,
      2,
    );
    const stored = await changes();
    const current = resolveConfiguration(owner, today, stored).items.find(
      (item) => item.id === "wake",
    )!;
    const future = resolveConfiguration(owner, "2026-10-16", stored).items.find(
      (item) => item.id === "wake",
    )!;
    expect(current).toMatchObject({
      label: "Wake early",
      helper: "Open the curtains",
      completion: { value: 600 },
    });
    expect(future).toMatchObject({
      label: "Wake early",
      helper: "Open the curtains",
      completion: { value: 540 },
    });
    expect(
      resolveConfiguration(owner, "2026-10-14", stored).items.find(
        (item) => item.id === "wake",
      )!.label,
    ).toBe("Wake-up time");
    expect(
      (await database.outbox.toArray()).map(
        (operation) => operation.configurationChange?.baseRevision,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("rejects a second local client's stale revision without overwriting its reviewed patch", async () => {
    secondDatabase = new AppDatabase(database.name);
    const secondClient = new LocalRepository(secondDatabase);
    const firstSnapshot = await configurationFor(owner, today, database);
    const secondSnapshot = await configurationFor(owner, today, secondDatabase);
    const retainedDraft: ConfigurationPatch = {
      blocks: [{ id: "general", title: "My routine" }],
    };
    await repository.saveConfiguration(
      owner,
      { blocks: [{ id: "general", icon: "sun" }] },
      today,
      firstSnapshot.revision,
    );
    await expect(
      secondClient.saveConfiguration(
        owner,
        retainedDraft,
        today,
        secondSnapshot.revision,
      ),
    ).rejects.toThrow("Your checklist changed");
    expect(await changes()).toHaveLength(1);
    expect(
      (await configurationFor(owner, today, database)).configuration.blocks[0],
    ).toMatchObject({ title: "General", icon: "sun" });
    expect(retainedDraft).toEqual({
      blocks: [{ id: "general", title: "My routine" }],
    });
    const refreshed = await configurationFor(owner, today, secondDatabase);
    await secondClient.saveConfiguration(
      owner,
      retainedDraft,
      today,
      refreshed.revision,
    );
    expect(
      (await configurationFor(owner, today, database)).configuration.blocks[0],
    ).toMatchObject({ title: "My routine", icon: "sun" });
    expect(await database.outbox.count()).toBe(2);
  });

  it("mirrors original fields and retains their answers when a new input generation is created", async () => {
    await repository.patchItem(owner, today, "applications", 1, {
      value: true,
      fields: { count: 2, reason: "Kept for context" },
    });
    expect((await repository.getDay(owner, today))?.data).toMatchObject({
      applicationsStatus: true,
      applicationsCount: 2,
      applicationsReason: "Kept for context",
    });
    await repository.saveConfiguration(
      owner,
      {
        items: [
          {
            id: "applications",
            kind: "number",
            generation: 2,
            followups: [],
            completion: {
              op: "compare",
              field: "value",
              operator: "gte",
              value: 3,
            },
          },
        ],
      },
      today,
      0,
    );
    await repository.patchItem(owner, today, "applications", 2, { value: 4 });
    expect((await answer("applications", 1))?.value).toMatchObject({
      generation: 1,
      value: true,
      fields: { count: 2 },
    });
    expect((await answer("applications", 2))?.value).toMatchObject({
      generation: 2,
      value: 4,
    });
    expect((await repository.getDay(owner, today))?.data).toMatchObject({
      applicationsStatus: true,
      applicationsCount: 2,
    });
    expect(await answer("applications", 1, "someone-else")).toBeUndefined();
  });

  it("records custom-list completion atomically, keeps manual work on same-day undo and preserves yesterday on later undo", async () => {
    await repository.saveConfiguration(owner, customListPatch(), today, 0);
    const manual = await repository.createTask(
      owner,
      "writing",
      "Research notes",
    );
    const automatic = await repository.createTask(
      owner,
      "writing",
      "Write first draft",
    );
    await repository.patchItem(owner, today, "writing-work", 1, {
      value: true,
      selections: [
        { taskId: manual, title: "Research notes", manual: true, children: [] },
      ],
    });
    await repository.completeTask(owner, automatic, true);
    let saved = (await answer("writing-work"))!.value;
    expect(saved.selections).toHaveLength(2);
    expect(
      saved.selections.find((selection) => selection.taskId === automatic)
        ?.automatic,
    ).toBeTruthy();
    const queued = (await database.outbox.toArray()).find(
      (operation) =>
        operation.taskCommand?.taskId === automatic &&
        operation.taskCommand.completed === true,
    )!;
    expect(queued.taskCommand?.checklistLink).toMatchObject({
      itemId: "writing-work",
      listId: "writing",
      generation: 1,
      configurationRevision: 1,
    });
    await repository.completeTask(owner, automatic, false);
    saved = (await answer("writing-work"))!.value;
    expect(saved.value).toBe(true);
    expect(saved.selections).toEqual([
      { taskId: manual, title: "Research notes", manual: true, children: [] },
    ]);
    await repository.completeTask(owner, automatic, true);
    const yesterday = structuredClone((await answer("writing-work"))!.value);
    vi.setSystemTime(new Date("2026-10-16T16:00:00Z"));
    await repository.completeTask(owner, automatic, false);
    expect((await answer("writing-work"))!.value).toEqual(yesterday);
    expect(
      await answer("writing-work", 1, owner, "2026-10-16"),
    ).toBeUndefined();
    expect((await database.tasks.get(automatic))?.completedAt).toBeNull();
    expect(
      await database.taskEvents.where("userId").equals(owner).count(),
    ).toBe(4);
  });

  it("requires a new answer generation when rebinding a linked question", async () => {
    await repository.saveConfiguration(
      owner,
      { lists: [{ id: "music", title: "Music", icon: "music", order: 4 }] },
      today,
      0,
    );
    await expect(
      repository.saveConfiguration(
        owner,
        { items: [{ id: "schoolTasks", listId: "music" }] },
        today,
        1,
      ),
    ).rejects.toThrow("new answer generation");
    expect(
      (await configurationFor(owner, today, database)).configuration.items.find(
        (item) => item.id === "schoolTasks",
      )!.listId,
    ).toBe("school");
  });

  it("rolls back a failed answer and legacy mirror, then retries the same operation once", async () => {
    const queue = vi
      .spyOn(database.outbox, "add")
      .mockRejectedValueOnce(new Error("Quota exceeded"));
    await expect(
      repository.patchItem(owner, today, "meal1", 1, {
        value: true,
        fields: { description: "Lunch" },
      }),
    ).rejects.toThrow("Quota exceeded");
    const operationId = queue.mock.calls[0][0].operationId;
    expect(await answer("meal1")).toBeUndefined();
    expect(await repository.getDay(owner, today)).toBeUndefined();
    expect(await database.outbox.count()).toBe(0);
    expect(repository.hasUnsaved(owner)).toBe(true);
    queue.mockRestore();
    await repository.retryUnsaved(owner);
    expect((await answer("meal1"))?.value).toMatchObject({
      value: true,
      fields: { description: "Lunch" },
    });
    expect((await repository.getDay(owner, today))?.data).toMatchObject({
      meal1Status: true,
      meal1Description: "Lunch",
    });
    expect(await database.outbox.toArray()).toMatchObject([
      { operationId, kind: "custom-answer" },
    ]);
    expect(await database.customAnswers.count()).toBe(1);
    expect(repository.hasUnsaved(owner)).toBe(false);
  });

  it("rolls back a configuration on queue failure without losing the retryable patch", async () => {
    const queue = vi
      .spyOn(database.outbox, "add")
      .mockRejectedValueOnce(new Error("Disk full"));
    await expect(
      repository.saveConfiguration(
        owner,
        { blocks: [{ id: "body", title: "Health" }] },
        today,
        0,
      ),
    ).rejects.toThrow("Disk full");
    const operationId = queue.mock.calls[0][0].operationId;
    expect(await changes()).toEqual([]);
    expect(repository.hasUnsaved(owner)).toBe(true);
    queue.mockRestore();
    await repository.retryUnsaved(owner);
    expect(await changes()).toMatchObject([
      {
        operationId,
        sequence: 1,
        patch: { blocks: [{ id: "body", title: "Health" }] },
      },
    ]);
    expect(await database.outbox.toArray()).toMatchObject([
      { operationId, kind: "configuration" },
    ]);
    expect(repository.hasUnsaved(owner)).toBe(false);
  });

  it("keeps demo configuration and answers local and resets only that demo's new tables", async () => {
    const demo = "local-demo:customization-a",
      anotherDemo = "local-demo:customization-b";
    await seedDemo(demo, false, database);
    await seedDemo(anotherDemo, false, database);
    for (const user of [owner, demo, anotherDemo]) {
      const date = user === owner ? today : "2026-10-13";
      await repository.saveConfiguration(
        user,
        { blocks: [{ id: "general", title: user }] },
        date,
        0,
      );
      await repository.patchItem(user, date, "lifted", 1, { value: true });
    }
    expect(
      (await database.outbox.toArray()).every(
        (operation) => operation.userId === owner,
      ),
    ).toBe(true);
    await seedDemo(demo, true, database);
    expect(await changes(demo)).toEqual([]);
    expect(
      await database.customAnswers.where("userId").equals(demo).count(),
    ).toBe(0);
    expect(await changes(owner)).toHaveLength(1);
    expect(await changes(anotherDemo)).toHaveLength(1);
    expect(
      await database.customAnswers.where("userId").equals(owner).count(),
    ).toBe(1);
    expect(
      await database.customAnswers.where("userId").equals(anotherDemo).count(),
    ).toBe(1);
    expect(
      (await repository.getDay(demo, "2026-10-13"))?.data.liftedStatus,
    ).toBeNull();
    expect(
      (await repository.getDay(anotherDemo, "2026-10-13"))?.data.liftedStatus,
    ).toBe(true);
  });

  it("leaves already queued legacy entry and task payloads unchanged during new writes", async () => {
    const legacyEntry: PendingOperation = {
      operationId: createId(),
      userId: owner,
      logicalDate: today,
      kind: "entry",
      createdAt: "2026-10-15T10:00:00Z",
      patch: { journalText: "Queued before upgrade", schoolTasksStatus: false },
    };
    const legacyTask: PendingOperation = {
      operationId: createId(),
      userId: owner,
      logicalDate: today,
      kind: "task",
      createdAt: "2026-10-15T10:01:00Z",
      taskCommand: {
        taskId: "older-task",
        action: "complete",
        completed: true,
        recordDaily: true,
        at: "2026-10-15T10:01:00Z",
        logicalDate: today,
        timezone: "America/New_York",
      },
    };
    const entryId = await database.outbox.add(legacyEntry),
      taskId = await database.outbox.add(legacyTask);
    const originals = [
      await database.outbox.get(entryId),
      await database.outbox.get(taskId),
    ];
    await repository.saveConfiguration(
      owner,
      { blocks: [{ id: "general", title: "Routine" }] },
      today,
      0,
    );
    await repository.patchItem(owner, today, "wake", 1, { value: "08:00" });
    expect([
      await database.outbox.get(entryId),
      await database.outbox.get(taskId),
    ]).toEqual(originals);
    expect((await database.outbox.get(taskId))?.taskCommand).not.toHaveProperty(
      "checklistLink",
    );
    expect(await database.outbox.count()).toBe(4);
  });
});
