import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./customization";
import {
  duplicateEditorItem,
  editorItem,
  normalizeEditorItem,
  summarizeItem,
  summarizeRule,
  summarizeSchedule,
} from "./editorPresentation";

describe("editor presentation and identities", () => {
  it("starts a new question with blank wording and keeps compatible edits on the current answer version", () => {
    const item = editorItem("number", "general", 0);
    expect(item.label).toBe("");
    expect(
      normalizeEditorItem(item, {
        ...item,
        label: "Steps",
        completion: {
          op: "compare",
          field: "value",
          operator: "gte",
          value: 5000,
        },
      }),
    ).toMatchObject({ id: item.id, generation: 1 });
    expect(
      normalizeEditorItem(item, { ...item, kind: "text" }).generation,
    ).toBe(2);
  });
  it("duplicates choices and compound references without retaining original identities", () => {
    const item = defaultConfiguration(
      "local-demo:summary",
      "2026-10-15",
    ).items.find((entry) => entry.id === "amBreakfast")!;
    const copy = duplicateEditorItem(item);
    expect(copy.id).not.toBe(item.id);
    expect(copy.legacyKey).toBeUndefined();
    expect(copy.followups[0].id).not.toBe(item.followups[0].id);
    const oldChoiceIds = item.followups.flatMap(
      (field) => field.options?.map((option) => option.id) ?? [],
    );
    expect(
      copy.followups
        .flatMap((field) => field.options?.map((option) => option.id) ?? [])
        .some((id) => oldChoiceIds.includes(id)),
    ).toBe(false);
    expect(JSON.stringify(copy.completion)).not.toContain(
      `"${item.followups[0].id}"`,
    );
  });
  it("summarizes conditions using choice labels and readable times instead of IDs", () => {
    const item = {
      ...editorItem("choice", "general", 0),
      options: [{ id: "choice-id", label: "Breakfast" }],
    };
    expect(
      summarizeRule({ op: "equals", field: "value", value: "choice-id" }, item),
    ).toBe("Answer is Breakfast");
    expect(
      summarizeItem({
        ...editorItem("boolean", "general", 0),
        completion: { op: "equals", field: "value", value: false },
      }),
    ).toBe("Yes / No · No earns a check");
    expect(
      summarizeRule(
        { op: "compare", field: "value", operator: "lte", value: 600 },
        editorItem("time", "general", 0),
      ),
    ).toBe("Answer at or before 10:00 AM");
    expect(
      summarizeSchedule({ weekdays: [1, 3, 5], startDate: "2026-10-15" }),
    ).toBe("Mon, Wed, Fri from 2026-10-15");
  });
});

it("offers only the original main controls and blocks retired types from new drafts", async () => {
  const { ITEM_TYPES, newMainInputError } =
    await import("./editorPresentation");
  expect(ITEM_TYPES.map((type) => type.kind)).toEqual([
    "boolean",
    "time",
    "duration",
    "tasks",
  ]);
  const before = {
    blocks: [{ id: "general", title: "General", icon: "star", order: 0 }],
    items: [],
    lists: [],
  };
  for (const kind of ["number", "text", "choice"] as const) {
    const item = { ...editorItem(kind, "general", 0), label: "Retired" };
    expect(newMainInputError(before, { ...before, items: [item] })).toContain(
      "Extra questions",
    );
    expect(
      newMainInputError(
        { ...before, items: [item] },
        { ...before, items: [{ ...item, label: "Retained" }] },
      ),
    ).toBeUndefined();
  }
});
