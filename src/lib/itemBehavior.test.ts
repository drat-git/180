import { describe, expect, it } from "vitest";
import {
  defaultAnswer,
  defaultConfiguration,
  evaluateItem,
  evaluateRule,
} from "./customization";
import { editorItem } from "./editorPresentation";
import { explainItemBehavior } from "./itemBehavior";
import type { ChecklistItem, ItemKind, Rule } from "./customizationTypes";

const explain = (item: ChecklistItem) => explainItemBehavior(item);

describe("live behavior explanations", () => {
  it.each<[ItemKind, Rule, unknown, unknown, string]>([
    [
      "checkbox",
      { op: "equals", field: "value", value: true },
      true,
      null,
      "you answer Yes",
    ],
    [
      "boolean",
      { op: "equals", field: "value", value: false },
      false,
      true,
      "you answer No",
    ],
    [
      "number",
      { op: "compare", field: "value", operator: "gte", value: 8 },
      8,
      7,
      "you enter at least 8",
    ],
    [
      "time",
      { op: "compare", field: "value", operator: "lte", value: 540 },
      "09:00",
      "09:01",
      "you enter a time at or before 9:00 AM",
    ],
    [
      "duration",
      { op: "compare", field: "value", operator: "gte", value: 90 },
      90,
      89,
      "you enter at least 1 hour and 30 minutes",
    ],
    [
      "text",
      { op: "not-empty", field: "value" },
      "Hello",
      "  ",
      "you provide a nonblank answer",
    ],
    [
      "choice",
      { op: "equals", field: "value", value: "meal" },
      "meal",
      "shake",
      "you choose “A meal”",
    ],
    [
      "tasks",
      { op: "equals", field: "value", value: true },
      true,
      false,
      "you record work on “School”",
    ],
  ])(
    "explains %s using the same successful and unsuccessful answers as the evaluator",
    (kind, rule, success, failure, phrase) => {
      const item: ChecklistItem = {
        ...editorItem(kind, "general", 0),
        completion: rule,
        ...(kind === "choice"
          ? {
              options: [
                { id: "meal", label: "A meal" },
                { id: "shake", label: "A shake" },
              ],
            }
          : {}),
        ...(kind === "tasks" ? { listId: "school" } : {}),
      };
      const result = explainItemBehavior(item, {
        lists: [{ id: "school", title: "School", icon: "book", order: 0 }],
      });
      expect(result.completion).toBe(`You earn a check when ${phrase}.`);
      expect(
        evaluateItem(item, { ...defaultAnswer(item), value: success as never })
          .complete,
      ).toBe(true);
      expect(
        evaluateItem(item, { ...defaultAnswer(item), value: failure as never })
          .complete,
      ).toBe(false);
    },
  );

  it.each([
    ["lt", "before"],
    ["lte", "at or before"],
    ["eq", "at"],
    ["gte", "at or after"],
    ["gt", "after"],
  ] as const)("keeps the %s time boundary explicit", (operator, wording) => {
    const item = {
      ...editorItem("time", "general", 0),
      completion: { op: "compare", field: "value", operator, value: 0 } as Rule,
    };
    expect(explain(item).completion).toBe(
      `You earn a check when you enter a time ${wording} 12:00 AM.`,
    );
  });

  it("preserves inclusive ranges and mixed AND/OR grouping", () => {
    const item = editorItem("number", "general", 0);
    item.completion = {
      op: "all",
      rules: [
        { op: "compare", field: "value", operator: "gte", value: 3 },
        {
          op: "any",
          rules: [
            { op: "compare", field: "value", operator: "lte", value: 8 },
            { op: "equals", field: "value", value: 12 },
          ],
        },
      ],
    };
    expect(explain(item).completion).toBe(
      "You earn a check when you enter at least 3 and (you enter at most 8 or you enter exactly 12).",
    );
    for (const [value, complete] of [
      [3, true],
      [8, true],
      [9, false],
      [12, true],
      [0, false],
    ] as const)
      expect(
        evaluateItem(item, { ...defaultAnswer(item), value }).complete,
      ).toBe(complete);
  });

  it("does not rewrite negation into No or the opposite threshold", () => {
    const item = editorItem("boolean", "general", 0);
    item.completion = {
      op: "not",
      rule: { op: "equals", field: "value", value: true },
    };
    expect(explain(item).completion).toContain(
      "it is not the case that (you answer Yes)",
    );
    expect(explain(item).details.join(" ")).toContain(
      "“Not Yes” is different from",
    );
    expect(evaluateItem(item, defaultAnswer(item)).complete).toBe(true);
    const numeric = {
      ...editorItem("number", "general", 0),
      completion: {
        op: "not",
        rule: { op: "compare", field: "value", operator: "gte", value: 8 },
      } as Rule,
    };
    expect(explain(numeric).completion).toContain(
      "not the case that (you enter at least 8)",
    );
    expect(evaluateItem(numeric, defaultAnswer(numeric)).complete).toBe(true);
  });

  it("distinguishes a provided false or zero answer from a blank answer", () => {
    for (const [kind, value] of [
      ["boolean", false],
      ["number", 0],
    ] as const) {
      const item = {
        ...editorItem(kind, "general", 0),
        completion: { op: "not-empty", field: "value" } as Rule,
      };
      expect(
        evaluateItem(item, { ...defaultAnswer(item), value }).complete,
      ).toBe(true);
      expect(evaluateItem(item, defaultAnswer(item)).complete).toBe(false);
      expect(explain(item).completion).toContain(
        kind === "boolean" ? "you answer Yes or No" : "you provide an answer",
      );
    }
  });

  it("includes required extra answers and their conditional visibility", () => {
    const item = defaultConfiguration(
      "local-demo:behavior",
      "2026-10-15",
    ).items.find((entry) => entry.id === "amBreakfast")!;
    const result = explain(item);
    expect(result.completion).toContain(
      "you answer Yes and you complete every required extra question that appears",
    );
    expect(result.followups[0]).toContain("If you answer Yes");
    expect(result.followups[0]).toContain("required when it appears");
    expect(result.details.join(" ")).toContain(
      "You must choose again for the new answer",
    );
    expect(result.details.join(" ")).toContain(
      "replaces the item’s question text",
    );
    expect(result.followups.join(" ")).not.toContain("field");
    const answer = { ...defaultAnswer(item), value: true };
    expect(evaluateItem(item, answer).complete).toBe(false);
    answer.fields.choice = "shake";
    expect(evaluateItem(item, answer).complete).toBe(true);
  });

  it("describes a reversed answer followed by a counter without making that counter required", () => {
    const item = {
      ...editorItem("boolean", "general", 0),
      completion: { op: "equals", field: "value", value: false } as Rule,
      followups: [
        {
          id: "times",
          label: "How many times?",
          kind: "counter" as const,
          condition: { op: "equals", field: "value", value: true } as Rule,
        },
      ],
    };
    expect(explain(item).completion).toBe(
      "You earn a check when you answer No.",
    );
    expect(explain(item).followups).toEqual([
      "If you answer Yes, we’ll ask “How many times?” This extra answer is optional.",
    ]);
  });

  it("explains required occurrence notes including zero, fractional and excessive counts", () => {
    const item = editorItem("number", "general", 0);
    item.followups = [
      {
        id: "notes",
        label: "Practice",
        kind: "occurrences",
        countField: "value",
        required: true,
      },
    ];
    const result = explain(item);
    expect(result.followups[0]).toContain("for each count in your main answer");
    expect(result.details.join(" ")).toContain(
      "blank or zero count displays no notes",
    );
    expect(result.details.join(" ")).toContain("positive whole number");
    expect(result.details.join(" ")).toContain("above 1,000");
    for (const [value, notes, complete] of [
      [0, [], false],
      [1.5, ["A", "B"], false],
      [2, ["A", "B"], true],
      [2, ["A", " "], false],
    ] as const)
      expect(
        evaluateItem(item, {
          ...defaultAnswer(item),
          value,
          fields: { notes: [...notes] },
        }).complete,
      ).toBe(complete);
  });

  it("uses the main rule result for completion-based visibility, before required extras", () => {
    const item = editorItem("boolean", "general", 0);
    item.followups = [
      {
        id: "why",
        label: "Why?",
        kind: "note",
        required: true,
        condition: { op: "complete", value: true },
      },
    ];
    expect(explain(item).followups[0]).toContain(
      "If your main completion condition matches",
    );
    const evaluation = evaluateItem(item, {
      ...defaultAnswer(item),
      value: true,
    });
    expect(evaluation.complete).toBe(false);
    expect(evaluation.followups).toHaveLength(1);
    expect(
      evaluateRule({ op: "complete", value: true }, evaluation.answer),
    ).toBe(false);
  });

  it("separates block and item schedules, allowed limits, and named list visibility", () => {
    const item = {
      ...editorItem("duration", "general", 0),
      min: 30,
      max: 120,
      schedule: { weekdays: [1, 3] },
    };
    const result = explainItemBehavior(item, {
      block: {
        id: "general",
        title: "Practice",
        icon: "book",
        order: 0,
        schedule: { startDate: "2026-10-15" },
      },
    });
    expect(result.details.join(" ")).toContain("Block schedule for “Practice”");
    expect(result.details.join(" ")).toContain("Item schedule: Mon, Wed");
    expect(result.details.join(" ")).toContain(
      "30 minutes through 2 hours, inclusive",
    );
    expect(result.details.join(" ")).toContain(
      "do not replace the completion goal",
    );
    const linked = {
      ...editorItem("tasks", "general", 0),
      listId: "work",
      visibility: "always" as const,
    };
    const context = {
      lists: [{ id: "work", title: "Work", order: 0, icon: "book" }],
    };
    expect(explainItemBehavior(linked, context).details.join(" ")).toContain(
      "“Work” always appears on its scheduled days",
    );
    expect(
      explainItemBehavior(
        { ...linked, visibility: "relevant" },
        context,
      ).details.join(" "),
    ).toContain("unfinished tasks for that day");
  });

  it.each<Rule>([
    { op: "always" },
    { op: "never" },
    { op: "all", rules: [] },
    { op: "any", rules: [] },
    { op: "complete", value: true },
    { op: "complete", value: false },
  ])("explains constant and empty rules without crashing", (completion) => {
    const item = { ...editorItem("boolean", "general", 0), completion };
    expect(explain(item).completion).toMatch(/always|never|whenever/);
    expect(explain(item)).toEqual(explain(structuredClone(item)));
  });

  it("uses readable placeholders for unfinished references and leaves definitions untouched", () => {
    const item = {
      ...editorItem("choice", "general", 0),
      options: [],
      completion: {
        op: "equals",
        field: "value",
        value: "opaque-choice-id",
      } as Rule,
    };
    item.followups = [
      {
        id: "note",
        kind: "note",
        label: "",
        condition: {
          op: "compare",
          field: "missing-field-id",
          operator: "gte",
          value: 1,
        },
      },
    ];
    const before = structuredClone(item);
    expect(JSON.stringify(explain(item))).not.toMatch(
      /opaque-choice-id|missing-field-id/,
    );
    expect(explain(item).followups[0]).toContain("Unnamed extra question");
    expect(explain(item).details.join(" ")).not.toContain("Every day");
    expect(item).toEqual(before);
  });

  it("preserves meaningful whitespace in exact text matches", () => {
    const item = {
      ...editorItem("text", "general", 0),
      completion: { op: "equals", field: "value", value: " hello " } as Rule,
    };
    expect(explain(item).completion).toContain("exactly “ hello ”");
    expect(
      evaluateItem(item, { ...defaultAnswer(item), value: "hello" }).complete,
    ).toBe(false);
    expect(
      evaluateItem(item, { ...defaultAnswer(item), value: " hello " }).complete,
    ).toBe(true);
  });
});
