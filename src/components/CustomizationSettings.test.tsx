import {
  registerAccountProfile,
  legacyAccountProfile,
} from "../lib/accountProfile";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  CustomizationEditorProps,
  ManageTodoListsProps,
} from "./CustomizationEditor";
import type { ConfigurationPatch } from "../lib/customizationTypes";
import { db } from "../lib/db";
import { repository } from "../lib/repository";
import { configurationFor } from "../lib/customizationStore";
import { CustomizationSettings } from "./CustomizationSettings";
import { editorRecoveryKey } from "../lib/editorRecovery";
import { defaultConfiguration } from "../lib/customization";

// Exercise the wrapper and real persistence while leaving detailed input behavior
// to the editor tests and browser scenarios.
vi.mock("./CustomizationEditor", async () => {
  const { useState } = await import("react");
  return {
    CustomizationEditor: (props: CustomizationEditorProps) => {
      const [error, setError] = useState("");
      async function save(date: string) {
        try {
          await props.onSave(
            props.initialDraft ?? props.configuration,
            date,
            props.baseRevision,
          );
        } catch (reason) {
          setError((reason as Error).message);
        }
      }
      return (
        <section aria-label="Checklist editor">
          <output aria-label="Checklist recovery">
            {JSON.stringify(props.recovery)}
          </output>
          <button onClick={() => props.onRecoveryChange?.(null)}>
            Clear checklist recovery
          </button>
          <output aria-label="Checklist draft">
            {JSON.stringify(props.initialDraft ?? props.configuration)}
          </output>
          <div aria-label="Retained list summary">
            {props.retainedListChanges?.map((list) => (
              <span key={list.id}>{list.title}</span>
            ))}
          </div>
          <button onClick={() => void save(props.today)}>Apply today</button>
          <button onClick={() => void save("2026-10-16")}>
            Start next day
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
      );
    },
    ManageTodoLists: (props: ManageTodoListsProps) => {
      const [error, setError] = useState("");
      const lists = props.initialLists ?? props.configuration.lists;
      async function saveLists() {
        try {
          await props.onSaveLists(lists, props.baseRevision);
        } catch (reason) {
          setError((reason as Error).message);
        }
      }
      async function saveConnection() {
        try {
          await props.onSaveConnection(
            {
              ...props.configuration,
              items: props.configuration.items.map((item) =>
                item.id === "schoolTasks"
                  ? { ...item, visibility: "always" }
                  : item,
              ),
            },
            "2026-10-16",
            props.baseRevision,
          );
        } catch (reason) {
          setError((reason as Error).message);
        }
      }
      return (
        <section aria-label="List manager">
          <output aria-label="List recovery">
            {JSON.stringify(props.recovery)}
          </output>
          <ul aria-label="Lists under review">
            {lists.map((list) => (
              <li key={list.id}>{list.title}</li>
            ))}
          </ul>
          {props.reviewRetainedLists && (
            <button onClick={() => void saveLists()}>
              Save retained list changes
            </button>
          )}
          {props.hasRetainedChecklistChanges && <p>Checklist draft retained</p>}
          <button onClick={props.onReviewChecklist}>
            Review checklist draft
          </button>
          <button onClick={() => void saveConnection()}>
            Save connection next day
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
      );
    },
  };
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
});
const today = "2026-10-15";
let identity = 0;
async function conflict(patch: ConfigurationPatch, answerItem?: string) {
  const userId = `settings-owner-${++identity}`;
  registerAccountProfile(legacyAccountProfile(userId));
  await repository.saveConfiguration(userId, patch, today, 0);
  if (answerItem)
    await repository.patchItem(userId, today, answerItem, 1, { value: true });
  const local = (
    await db.configurations.where("userId").equals(userId).toArray()
  )[0];
  await db.configurations.put({ ...local, conflict: "Configuration conflict" });
  await db.configurations.put({
    id: `server-${userId}`,
    operationId: `server-${userId}`,
    userId,
    baseRevision: 0,
    sequence: 1,
    effectiveDate: today,
    patch: { blocks: [{ id: "general", title: "Latest server routine" }] },
    createdAt: `${today}T12:00:00Z`,
    revision: 1,
  });
  await db.meta.put({
    key: `customization-conflict:${userId}`,
    value: JSON.stringify({ patch, operationId: local.operationId }),
  });
  return userId;
}
const newList: ConfigurationPatch = {
  lists: [
    { id: "fitness", title: "Fitness retained", icon: "heart", order: 3 },
  ],
};
const mixed: ConfigurationPatch = {
  ...newList,
  blocks: [{ id: "routine", title: "Retained routine", icon: "sun", order: 5 }],
  items: [
    {
      id: "new-question",
      blockId: "routine",
      label: "Read a chapter",
      kind: "boolean",
      generation: 1,
      order: 0,
      completion: { op: "equals", field: "value", value: true },
      followups: [],
    },
  ],
};
async function open(
  userId: string,
  kind: "checklist" | "lists" = "lists",
  onClose = vi.fn(),
) {
  render(
    <CustomizationSettings
      userId={userId}
      today={today}
      kind={kind}
      onClose={onClose}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Review retained draft" }),
  );
  return onClose;
}

it("shows retained list-only changes, rebases them immediately, and preserves a separate unsaved checklist draft", async () => {
  const userId = await conflict(newList);
  await db.meta.put({
    key: `customization-draft:${userId}`,
    value: JSON.stringify({
      patch: { blocks: [{ id: "general", title: "My unsaved routine" }] },
    }),
  });
  await open(userId);
  expect(await screen.findByText("Fitness retained")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Save retained list changes" }),
  );
  await waitFor(async () =>
    expect(
      await db.meta.get(`customization-conflict:${userId}`),
    ).toBeUndefined(),
  );
  const current = await configurationFor(userId, today);
  expect(current.configuration.lists).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "fitness", title: "Fitness retained" }),
    ]),
  );
  expect(
    current.configuration.blocks.find((block) => block.id === "general")?.title,
  ).toBe("Latest server routine");
  const draft = JSON.parse(
    (await db.meta.get(`customization-draft:${userId}`))!.value,
  ).patch;
  expect(draft).toEqual({
    blocks: [{ id: "general", title: "My unsaved routine" }],
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Review checklist draft" }),
  );
  expect(await screen.findByLabelText("Checklist draft")).toHaveTextContent(
    "My unsaved routine",
  );
  expect(
    (await db.outbox.where("userId").equals(userId).toArray()).filter(
      (op) => op.kind === "configuration",
    ),
  ).toHaveLength(1);
});

it("routes a mixed conflict to combined review and atomically keeps definitions required by queued answers", async () => {
  const userId = await conflict(mixed, "new-question");
  const saved = vi.spyOn(repository, "saveConfiguration");
  const close = await open(userId);
  expect(
    await screen.findByRole("region", { name: "Checklist editor" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Retained list summary")).toHaveTextContent(
    "Fitness retained",
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply today" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved).toHaveBeenCalledWith(
    userId,
    expect.objectContaining({
      lists: expect.any(Array),
      items: expect.any(Array),
      blocks: expect.any(Array),
    }),
    today,
    1,
  );
  const current = await configurationFor(userId, today);
  expect(
    current.configuration.items.some((item) => item.id === "new-question"),
  ).toBe(true);
  expect(
    await db.customAnswers.get([userId, today, "new-question", 1]),
  ).toMatchObject({ value: { value: true } });
  const queue = await db.outbox.where("userId").equals(userId).sortBy("id");
  expect(queue.map((op) => op.kind)).toEqual([
    "configuration",
    "custom-answer",
  ]);
  expect(await db.meta.get(`customization-conflict:${userId}`)).toBeUndefined();
});

it("lets a reviewed no-op resolve the old conflicting queue instead of only hiding the warning", async () => {
  const userId = await conflict({ lists: [{ id: "career", title: "Career" }] });
  const saved = vi.spyOn(repository, "saveConfiguration");
  await open(userId);
  fireEvent.click(
    await screen.findByRole("button", { name: "Save retained list changes" }),
  );
  await waitFor(async () =>
    expect(
      await db.meta.get(`customization-conflict:${userId}`),
    ).toBeUndefined(),
  );
  expect(saved).toHaveBeenCalledWith(userId, {}, today, 1);
  const queue = (
    await db.outbox.where("userId").equals(userId).toArray()
  ).filter((op) => op.kind === "configuration");
  expect(queue).toHaveLength(1);
  expect(queue[0].configurationChange?.patch).toEqual({});
  expect(
    (await db.configurations.where("userId").equals(userId).toArray()).some(
      (change) => !!change.conflict,
    ),
  ).toBe(false);
});

it("rejects a stale reviewed revision and keeps the retained payload available", async () => {
  const userId = await conflict(newList);
  const saved = vi.spyOn(repository, "saveConfiguration"),
    rebase = vi.spyOn(repository, "rebaseConfigurationConflict");
  await open(userId);
  await screen.findByText("Fitness retained");
  await db.configurations.put({
    id: "newer-server",
    operationId: "newer-server",
    userId,
    baseRevision: 1,
    sequence: 2,
    effectiveDate: today,
    patch: {
      blocks: [{ id: "general", title: "Another device changed this" }],
    },
    createdAt: `${today}T13:00:00Z`,
    revision: 2,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save retained list changes" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Close and reopen",
  );
  expect(saved).not.toHaveBeenCalled();
  expect(rebase).not.toHaveBeenCalled();
  expect(await db.meta.get(`customization-conflict:${userId}`)).toBeDefined();
});

it("keeps mixed dependent drafts available when next-day publishing would orphan queued answers", async () => {
  const userId = await conflict(mixed, "new-question");
  const close = await open(userId);
  fireEvent.click(
    await screen.findByRole("button", { name: "Start next day" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "answers waiting to sync",
  );
  expect(await db.meta.get(`customization-conflict:${userId}`)).toBeDefined();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply today" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(
    (await configurationFor(userId, today)).configuration.items.some(
      (item) => item.id === "new-question",
    ),
  ).toBe(true);
});

it("publishes mixed list changes today while scheduling checklist changes for tomorrow", async () => {
  const userId = await conflict(mixed);
  const close = await open(userId);
  fireEvent.click(
    await screen.findByRole("button", { name: "Start next day" }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const current = (await configurationFor(userId, today)).configuration;
  const tomorrow = (await configurationFor(userId, "2026-10-16")).configuration;
  expect(current.lists.some((list) => list.id === "fitness")).toBe(true);
  expect(current.items.some((item) => item.id === "new-question")).toBe(false);
  expect(tomorrow.items.some((item) => item.id === "new-question")).toBe(true);
  expect(await db.meta.get(`customization-draft:${userId}`)).toBeUndefined();
});

it("preserves unrelated checklist draft fields when publishing a connected question", async () => {
  const userId = `settings-owner-${++identity}`;
  registerAccountProfile(legacyAccountProfile(userId));
  await db.meta.put({
    key: `customization-draft:${userId}`,
    value: JSON.stringify({
      patch: {
        blocks: [{ id: "general", title: "My draft heading" }],
        items: [{ id: "schoolTasks", helper: "Draft instructions" }],
      },
    }),
  });
  const close = vi.fn();
  render(
    <CustomizationSettings
      userId={userId}
      today={today}
      kind="lists"
      onClose={close}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Save connection next day" }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const retained = JSON.parse(
    (await db.meta.get(`customization-draft:${userId}`))!.value,
  ).patch;
  expect(retained.blocks).toEqual([
    { id: "general", title: "My draft heading" },
  ]);
  expect(retained.items).toEqual([
    { id: "schoolTasks", helper: "Draft instructions" },
  ]);
  expect(
    (await configurationFor(userId, today)).configuration.items.find(
      (item) => item.id === "schoolTasks",
    )?.visibility,
  ).toBe("relevant");
  expect(
    (await configurationFor(userId, "2026-10-16")).configuration.items.find(
      (item) => item.id === "schoolTasks",
    )?.visibility,
  ).toBe("always");
});

it("retains the daily remainder and explains when the second split save fails", async () => {
  const userId = await conflict(mixed);
  const originalSave = repository.saveConfiguration.bind(repository);
  vi.spyOn(repository, "saveConfiguration").mockImplementation(
    (account, patch, date, revision) => {
      if (date === "2026-10-16") return Promise.reject(new Error("Disk busy"));
      return originalSave(account, patch, date, revision);
    },
  );
  const close = await open(userId);
  fireEvent.click(
    await screen.findByRole("button", { name: "Start next day" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your To-do list changes were saved. Your checklist draft is retained",
  );
  expect(close).not.toHaveBeenCalled();
  expect(
    (await configurationFor(userId, today)).configuration.lists.some(
      (list) => list.id === "fitness",
    ),
  ).toBe(true);
  expect(
    (await configurationFor(userId, "2026-10-16")).configuration.items.some(
      (item) => item.id === "new-question",
    ),
  ).toBe(false);
  const retained = JSON.parse(
    (await db.meta.get(`customization-draft:${userId}`))!.value,
  ).patch;
  expect(retained.blocks).toEqual(mixed.blocks);
  expect(retained.items).toEqual(mixed.items);
  expect(retained.lists).toBeUndefined();
  expect(await db.meta.get(`customization-conflict:${userId}`)).toBeUndefined();
});

it("keeps a queued answer to an existing changed input version during mixed review", async () => {
  const patch: ConfigurationPatch = {
    ...newList,
    items: [
      { id: "wake", kind: "number", generation: 2, legacyKey: undefined },
    ],
  };
  const userId = await conflict(patch);
  // The original edit already created this answer schema before its config conflicted.
  await db.customAnswers.put({
    userId,
    logicalDate: today,
    itemId: "wake",
    generation: 2,
    value: { generation: 2, value: 5, fields: {}, selections: [] },
    revision: 0,
    createdAt: `${today}T12:00:00Z`,
    updatedAt: `${today}T12:00:00Z`,
  });
  await db.outbox.add({
    operationId: "changed-input-answer",
    userId,
    logicalDate: today,
    kind: "custom-answer",
    customAnswer: { itemId: "wake", generation: 2, patch: { value: 5 } },
    createdAt: `${today}T12:00:00Z`,
  });
  const close = await open(userId);
  fireEvent.click(await screen.findByRole("button", { name: "Apply today" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(
    (await configurationFor(userId, today)).configuration.items.find(
      (item) => item.id === "wake",
    )?.generation,
  ).toBe(2);
});

it("loads the rendered editor's recovery and clears only that section after switching from lists", async () => {
  const userId = `settings-owner-${++identity}`;
  registerAccountProfile(legacyAccountProfile(userId));
  const configuration = defaultConfiguration(userId, today);
  const wake = configuration.items.find((item) => item.id === "wake")!;
  const checklistRecovery = {
    section: "checklist",
    baseRevision: 0,
    selectionId: "general",
    form: {
      kind: "item",
      before: wake,
      value: { ...wake, label: "Recovered wake question" },
      isNew: false,
    },
  };
  const listRecovery = {
    section: "lists",
    baseRevision: 0,
    drafts: [
      {
        kind: "list",
        before: null,
        value: {
          id: "new-local-list",
          title: "Keep this list draft",
          icon: "book",
          order: 3,
        },
        isNew: true,
      },
    ],
  };
  await db.meta.bulkPut([
    {
      key: editorRecoveryKey(userId, "checklist"),
      value: JSON.stringify(checklistRecovery),
    },
    {
      key: editorRecoveryKey(userId, "lists"),
      value: JSON.stringify(listRecovery),
    },
    {
      key: `customization-draft:${userId}`,
      value: JSON.stringify({
        patch: { blocks: [{ id: "body", title: "My health" }] },
      }),
    },
  ]);
  render(
    <CustomizationSettings
      userId={userId}
      today={today}
      kind="lists"
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByLabelText("List recovery")).toHaveTextContent(
    "Keep this list draft",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review checklist draft" }),
  );
  expect(await screen.findByLabelText("Checklist recovery")).toHaveTextContent(
    "Recovered wake question",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Clear checklist recovery" }),
  );
  await waitFor(async () =>
    expect(
      await db.meta.get(editorRecoveryKey(userId, "checklist")),
    ).toBeUndefined(),
  );
  expect(
    JSON.parse((await db.meta.get(editorRecoveryKey(userId, "lists")))!.value),
  ).toEqual(listRecovery);
});
