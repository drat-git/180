import { describe, expect, it } from "vitest";
import {
  starterTemplates,
  starterSelection,
  selectStarterList,
  selectedStarterConfiguration,
} from "./starters";
import {
  validateConfiguration,
  evaluateItem,
  emptyItemAnswer,
} from "./customization";

describe("public starter catalog", () => {
  it.each(starterTemplates)(
    "validates $title without private legacy fields",
    (template) => {
      expect(validateConfiguration(template.configuration)).toEqual([]);
      expect(
        template.configuration.items.every((item) => !item.legacyKey),
      ).toBe(true);
      expect(
        selectedStarterConfiguration(template, starterSelection(template)),
      ).toEqual(template.configuration);
      if (template.id === "blank") {
        expect(template.configuration.items).toHaveLength(0);
        expect(template.tasks).toHaveLength(0);
        expect(template.activities).toHaveLength(0);
      } else {
        expect(template.configuration.items).toHaveLength(6);
        expect(template.configuration.lists).toHaveLength(2);
        expect(template.tasks).toHaveLength(3);
        expect(
          template.activities.filter(
            (activity) => activity.itemType === "reusable",
          ),
        ).toHaveLength(5);
        expect(
          template.activities.filter(
            (activity) => activity.itemType === "one-time",
          ),
        ).toHaveLength(1);
        expect(
          template.configuration.items
            .filter((item) => item.kind === "tasks")
            .every((item) => item.visibility === "relevant"),
        ).toBe(true);
      }
    },
  );
  it("removes list dependencies and never re-adds them silently", () => {
    const template = starterTemplates[1];
    const list = template.configuration.lists[0];
    const initial = starterSelection(template);
    const removed = selectStarterList(template, initial, list.id, false);
    expect(removed.tasks).toHaveLength(1);
    expect(removed.items).toHaveLength(5);
    const restored = selectStarterList(template, removed, list.id, true);
    expect([...restored.lists].sort()).toEqual([...initial.lists].sort());
    expect(restored.items).toEqual(removed.items);
    expect(restored.tasks).toEqual(removed.tasks);
    expect(initial.items).toHaveLength(6);
  });
  it("omits empty blocks and accepts everything deselected", () => {
    const template = starterTemplates[0];
    const selection = {
      ...starterSelection(template),
      items: [],
      lists: [],
      tasks: [],
      activities: [],
    };
    expect(selectedStarterConfiguration(template, selection)).toEqual({
      blocks: [],
      items: [],
      lists: [],
    });
  });
  it("uses duration goals with blank answers remaining incomplete", () => {
    const durations = starterTemplates.flatMap((template) =>
      template.configuration.items.filter((item) => item.kind === "duration"),
    );
    expect(durations.length).toBeGreaterThan(0);
    for (const item of durations) {
      expect(evaluateItem(item, emptyItemAnswer(item)).complete).toBe(false);
    }
  });
});
