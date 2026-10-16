import { describe, expect, it } from "vitest";
import type { ChecklistItem, Configuration } from "./customizationTypes";
import { editorItem } from "./editorPresentation";
import {
  applyEditorFormChanges,
  readEditorRecovery,
  rebaseEditorRecovery,
  resolveEditorFormConflicts,
  type EditorRecoveryForm,
  type EditorRecoveryState,
} from "./editorRecovery";

const checklistItem = () => ({
  ...editorItem("number", "general", 0),
  label: "Pages read",
  helper: "A few pages each day",
});
function config(item: ChecklistItem): Configuration {
  return {
    items: [item],
    blocks: [{ id: "general", title: "General", icon: "circle", order: 0 }],
    lists: [{ id: "reading", title: "Reading", icon: "book", order: 0 }],
  };
}
function state(
  before: ChecklistItem,
  value: ChecklistItem,
): EditorRecoveryState {
  return {
    section: "checklist",
    baseRevision: 1,
    form: { kind: "item", before, value, isNew: false },
    selectionId: "general",
    level: "form",
  };
}
const rebasedItem = (value: EditorRecoveryState) =>
  value.form as Extract<EditorRecoveryForm, { kind: "item" | "connection" }>;

describe("unfinished editor recovery", () => {
  it("keeps an unrelated remote threshold and reorder while recovering a local rename", () => {
    const before = checklistItem(),
      local = { ...before, label: "Reading goal" },
      remote = {
        ...before,
        completion: {
          op: "compare" as const,
          field: "value",
          operator: "gte" as const,
          value: 20,
        },
        order: 3,
        helper: "Updated guidance",
      };
    const rebased = rebaseEditorRecovery(
      state(before, local),
      config(remote),
      8,
    );
    expect(rebasedItem(rebased).value).toEqual({
      ...remote,
      label: "Reading goal",
    });
    expect(rebasedItem(rebased).before).toEqual(remote);
    expect(rebasedItem(rebased).conflicts).toBeUndefined();
    expect(rebased.baseRevision).toBe(8);
    expect(before.label).toBe("Pages read");
  });

  it("flags concurrent completion edits and lets the user keep only their intended changes", () => {
    const before = checklistItem();
    const local = {
      ...before,
      label: "Read more",
      completion: {
        op: "compare" as const,
        field: "value",
        operator: "gte" as const,
        value: 10,
      },
    };
    const remote = {
      ...before,
      completion: {
        op: "compare" as const,
        field: "value",
        operator: "gte" as const,
        value: 30,
      },
      order: 2,
    };
    const form = rebasedItem(
      rebaseEditorRecovery(state(before, local), config(remote), 2),
    );
    expect(form.conflicts).toEqual(["completion"]);
    const latest = resolveEditorFormConflicts(form, false);
    expect(latest.value).toEqual({ ...remote, label: "Read more" });
    expect(latest.conflicts).toBeUndefined();
    const kept = resolveEditorFormConflicts(form, true);
    expect(kept.value.completion).toEqual(local.completion);
    expect(kept.value.order).toBe(2);
    expect(kept.conflicts).toBeUndefined();
  });

  it("treats competing choice arrays as a conflict without losing a separate local label", () => {
    const before = {
      ...checklistItem(),
      kind: "choice" as const,
      options: [
        { id: "first", label: "One" },
        { id: "second", label: "Two" },
      ],
    };
    const local = {
      ...before,
      label: "Pick a book",
      options: [{ id: "first", label: "First book" }, before.options[1]],
    };
    const remote = {
      ...before,
      options: [
        { id: "second", label: "Two" },
        { id: "first", label: "One" },
      ],
    };
    const form = rebasedItem(
      rebaseEditorRecovery(state(before, local), config(remote), 2),
    );
    expect(form.conflicts).toEqual(["options"]);
    expect(resolveEditorFormConflicts(form, false).value).toMatchObject({
      label: "Pick a book",
      options: remote.options,
    });
  });

  it("retains unresolved conflicts across saved recovery and repeated reloads", () => {
    const before = checklistItem(),
      local = { ...before, label: "Local label" },
      remote = { ...before, label: "Remote label" };
    const first = rebaseEditorRecovery(state(before, local), config(remote), 2);
    const saved = readEditorRecovery(JSON.stringify(first), "checklist")!;
    const reloaded = rebaseEditorRecovery(saved, config(remote), 2);
    expect(reloaded.form?.conflicts).toEqual(["label"]);
    expect(rebasedItem(reloaded).value.label).toBe("Local label");
    const resolved = {
      ...reloaded,
      form: resolveEditorFormConflicts(reloaded.form!, true),
    };
    expect(
      rebaseEditorRecovery(resolved, config(remote), 2).form?.conflicts,
    ).toBeUndefined();
  });

  it("keeps the current identity and answer generation rather than recovering derived metadata", () => {
    const before: ChecklistItem = {
      ...checklistItem(),
      generation: 1,
      legacyKey: "legacy-key",
    };
    const local = {
      ...before,
      label: "New question",
      generation: 2,
      legacyKey: undefined,
    };
    const remote = { ...before, generation: 7, legacyKey: "current-key" };
    expect(applyEditorFormChanges(before, local, remote)).toMatchObject({
      id: remote.id,
      generation: 7,
      legacyKey: "current-key",
      label: "New question",
    });
    const rebased = rebaseEditorRecovery(
      state(before, local),
      config(remote),
      9,
    );
    expect(rebasedItem(rebased).value.generation).toBe(7);
    expect(rebased.form?.conflicts).toBeUndefined();
  });

  it("marks missing or archived definitions as removed and never silently revives them", () => {
    const before = checklistItem(),
      local = { ...before, label: "Recovered question", deleted: false };
    const missing = rebaseEditorRecovery(
      state(before, local),
      { ...config(before), items: [] },
      2,
    );
    expect(missing.form?.conflicts).toContain("__removed");
    expect(missing.form?.value).toEqual(local);
    const archived = { ...before, deleted: true };
    expect(
      rebaseEditorRecovery(state(before, local), config(archived), 2).form
        ?.conflicts,
    ).toContain("__removed");
    expect(applyEditorFormChanges(before, local, archived).deleted).toBe(true);
  });

  it("restores a conflicting removed property by deleting it while retaining other local edits", () => {
    const before = checklistItem(),
      local = { ...before, helper: "My guidance", label: "Read daily" },
      remote = { ...before };
    delete (remote as Partial<ChecklistItem>).helper;
    const form = rebasedItem(
      rebaseEditorRecovery(state(before, local), config(remote), 2),
    );
    expect(form.conflicts).toEqual(["helper"]);
    const resolved = resolveEditorFormConflicts(form, false);
    expect(resolved.value.label).toBe("Read daily");
    expect(Object.hasOwn(resolved.value, "helper")).toBe(false);
    const removedLocally = { ...before };
    delete (removedLocally as Partial<ChecklistItem>).helper;
    expect(
      Object.hasOwn(
        applyEditorFormChanges(before, removedLocally, before),
        "helper",
      ),
    ).toBe(false);
  });

  it("rebases retained list and block drafts and leaves a genuine unsaved item new", () => {
    const item = checklistItem(),
      configuration = config(item),
      block = configuration.blocks[0],
      list = configuration.lists[0];
    const recovery: EditorRecoveryState = {
      section: "lists",
      baseRevision: 1,
      form: {
        kind: "item",
        before: null,
        value: { ...item, id: "new-item" },
        isNew: true,
      },
      drafts: [
        {
          kind: "list",
          before: list,
          value: { ...list, title: "Books" },
          isNew: false,
        },
        {
          kind: "block",
          before: block,
          value: { ...block, title: "Reading" },
          isNew: false,
        },
      ],
    };
    const rebased = rebaseEditorRecovery(
      recovery,
      {
        ...configuration,
        lists: [{ ...list, order: 3 }],
        blocks: [{ ...block, icon: "book" }],
      },
      6,
    );
    expect(rebased.form?.isNew).toBe(true);
    expect(rebased.form?.conflicts).toBeUndefined();
    expect(rebased.drafts?.[0].value).toMatchObject({
      title: "Books",
      order: 3,
    });
    expect(rebased.drafts?.[1].value).toMatchObject({
      title: "Reading",
      icon: "book",
    });
    expect(
      readEditorRecovery(
        JSON.stringify({
          ...recovery,
          form: { ...recovery.form, conflicts: [7] },
        }),
        "lists",
      ),
    ).toBeUndefined();
  });

  it("rejects incomplete or malformed recovered forms before their controls render", () => {
    const item = checklistItem(),
      valid = state(item, item);
    const invalid = [
      { ...item, kind: undefined },
      { ...item, blockId: undefined },
      { ...item, label: undefined },
      { ...item, followups: undefined },
      { ...item, followups: [null] },
      { ...item, options: "invalid" },
      { ...item, completion: { op: "all", rules: "invalid" } },
    ];
    for (const value of invalid)
      expect(
        readEditorRecovery(
          JSON.stringify({ ...valid, form: { ...valid.form, value } }),
          "checklist",
        ),
      ).toBeUndefined();
    expect(
      readEditorRecovery(
        JSON.stringify({
          ...valid,
          form: { ...valid.form, before: { id: item.id } },
        }),
        "checklist",
      ),
    ).toBeUndefined();
    expect(
      readEditorRecovery(
        JSON.stringify({
          ...valid,
          form: {
            kind: "block",
            before: null,
            value: { id: "block", title: "Block" },
            isNew: true,
          },
        }),
        "checklist",
      ),
    ).toBeUndefined();
    expect(readEditorRecovery(JSON.stringify(valid), "checklist")).toEqual(
      valid,
    );
  });
});
