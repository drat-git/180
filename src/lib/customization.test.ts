import { beforeEach as registerLegacyBeforeEach } from "vitest";
import { registerAccountProfile, legacyAccountProfile } from "./accountProfile";
registerLegacyBeforeEach(() => {
  registerAccountProfile(legacyAccountProfile("owner"));
  registerAccountProfile(legacyAccountProfile("default"));
});
import { describe, expect, it } from "vitest";
import {
  answersForConfiguration,
  changeItemValue,
  configurationDiff,
  customChecklistProgress,
  defaultConfiguration,
  emptyItemAnswer,
  evaluateItem,
  evaluateRule,
  itemAnswerKey,
  legacyItemAnswer,
  listActivityRelevant,
  resolveConfiguration,
  validateConfiguration,
  validateItemAnswer,
  type ChecklistItem,
  type ConfigChange,
} from "./customization";
import { checklistProgress } from "./checklist";
import { modeForUser } from "./appMode";
import { emptyData, type Task } from "./model";
import { addDays, logicalDate } from "./dates";

const configuration = () => defaultConfiguration("owner", "2026-10-15");
const getItem = (id: string) =>
  configuration().items.find((item) => item.id === id)!;
const change = (
  sequence: number,
  effectiveDate: string,
  patch: ConfigChange["patch"],
  extra: Partial<ConfigChange> = {},
): ConfigChange => ({
  id: `change-${sequence}`,
  operationId: `operation-${sequence}`,
  userId: "owner",
  sequence,
  baseRevision: sequence - 1,
  effectiveDate,
  patch,
  createdAt: `2026-10-15T12:00:0${sequence}Z`,
  ...extra,
});

describe("customizable checklist templates", () => {
  it("validates both templates across legacy food and supplement cutovers", () => {
    for (const user of ["owner", "local-demo:test"]) {
      for (const date of [
        "2026-10-09",
        "2026-10-11",
        "2026-10-12",
        "2026-10-13",
      ]) {
        expect(validateConfiguration(defaultConfiguration(user, date))).toEqual(
          [],
        );
      }
    }
  });
  it("reproduces legacy daily scoring across schedules, inputs, counts, and modes", () => {
    for (const user of ["owner", "local-demo:test"])
      for (const date of [
        "2026-10-09",
        "2026-10-11",
        "2026-10-12",
        "2026-10-13",
      ]) {
        for (const status of [null, true, false])
          for (const usageCount of [null, 1, 2, 3]) {
            const data = emptyData();
            for (const key of Object.keys(data))
              if (key.endsWith("Status"))
                Object.assign(data, { [key]: status });
            data.wakeTime = status === null ? null : status ? "08:30" : "11:00";
            data.screenTimeMinutes =
              status === null ? null : status ? 210 : 211;
            data.cannabisCount = usageCount;
            data.amBreakfast = {
              status,
              choice: status === true ? "meal" : null,
            };
            const config = defaultConfiguration(user, date);
            const result = customChecklistProgress(
              config,
              answersForConfiguration(config, data),
              date,
              { school: true, career: true },
            );
            const legacy = checklistProgress(
              data,
              date,
              { school: true, career: true },
              modeForUser(user),
            );
            expect(
              [result.completed, result.total],
              `${user} ${date} ${status} ${usageCount}`,
            ).toEqual([legacy.completed, legacy.total]);
          }
      }
  });
  it("requires the breakfast choice but treats meal descriptions as optional", () => {
    const item = getItem("amBreakfast");
    const answer = changeItemValue(item, emptyItemAnswer(item), true);
    expect(evaluateItem(item, answer).complete).toBe(false);
    answer.fields.choice = "meal";
    expect(evaluateItem(item, answer).complete).toBe(true);
    expect(
      evaluateItem(item, answer).followups.map((field) => field.id),
    ).toEqual(["choice", "description"]);
    expect(changeItemValue(item, answer, false).fields.choice).toBeNull();
  });
  it("keeps hidden occurrence descriptions and count while toggling Yes and No", () => {
    const item = getItem("cannabis");
    const answer = legacyItemAnswer(item, {
      ...emptyData(),
      cannabisStatus: true,
      cannabisCount: 2,
      cannabisUseDescriptions: ["first", "second"],
    });
    expect(evaluateItem(item, answer).complete).toBe(true);
    expect(
      evaluateItem(item, { ...answer, fields: { ...answer.fields, count: 3 } })
        .complete,
    ).toBe(false);
    const no = changeItemValue(item, answer, false);
    expect(evaluateItem(item, no).complete).toBe(true);
    expect(no.fields.occurrences).toEqual(["first", "second"]);
    expect(changeItemValue(item, no, true).fields.count).toBe(2);
  });
  it("does not coerce missing input to a successful zero threshold", () => {
    const item = getItem("screenTime");
    expect(evaluateItem(item, emptyItemAnswer(item)).complete).toBe(false);
    expect(
      evaluateItem(item, { ...emptyItemAnswer(item), value: 0 }).complete,
    ).toBe(true);
    const wake = getItem("wake");
    expect(
      evaluateItem(wake, { ...emptyItemAnswer(wake), value: "10:00" }).complete,
    ).toBe(true);
    expect(
      evaluateItem(wake, { ...emptyItemAnswer(wake), value: "10:01" }).complete,
    ).toBe(false);
  });
  it("hydrates new same-generation follow-up defaults while preserving explicit clears and hidden fields", () => {
    const item: ChecklistItem = {
      ...getItem("applications"),
      followups: [
        {
          id: "new-count",
          kind: "counter",
          label: "Sessions",
          defaultValue: 1,
          min: 1,
        },
      ],
      completion: {
        op: "all",
        rules: [
          { op: "equals", field: "value", value: true },
          { op: "compare", field: "new-count", operator: "gte", value: 1 },
        ],
      },
    };
    const stored = {
      generation: 1,
      value: true,
      fields: { reason: null, retiredNote: "Keep this hidden note" },
      selections: [],
    };
    const config = { ...configuration(), items: [item] };
    const hydrated = answersForConfiguration(config, emptyData(), {
      [itemAnswerKey(item)]: stored,
    })[itemAnswerKey(item)];
    expect(hydrated.fields).toEqual({
      "new-count": 1,
      reason: null,
      retiredNote: "Keep this hidden note",
    });
    expect(evaluateItem(item, stored).complete).toBe(true);
    const explicitlyCleared = {
      ...stored,
      fields: { ...stored.fields, "new-count": null },
    };
    expect(
      evaluateItem(item, explicitlyCleared).answer.fields["new-count"],
    ).toBeNull();
    expect(evaluateItem(item, explicitlyCleared).complete).toBe(false);
    expect(stored.fields).not.toHaveProperty("new-count");
  });

  it("retains old answer generations without reading them as a new input type", () => {
    const item = {
      ...getItem("applications"),
      kind: "number",
      generation: 2,
    } as ChecklistItem;
    const old = legacyItemAnswer(getItem("applications"), {
      ...emptyData(),
      applicationsStatus: true,
      applicationsCount: 4,
    });
    expect(
      legacyItemAnswer(item, { ...emptyData(), applicationsStatus: true })
        .value,
    ).toBeNull();
    const config = { ...configuration(), items: [item] };
    const values = answersForConfiguration(config, emptyData(), {
      [itemAnswerKey(item.id, 1)]: old,
    });
    expect(values[itemAnswerKey(item)].value).toBeNull();
    expect(evaluateItem(item, old).answered).toBe(false);
  });
});

describe("configuration history and generic rules", () => {
  it("applies scheduled field changes without overwriting unrelated later edits", () => {
    const baseline = configuration();
    const tomorrow = structuredClone(baseline);
    tomorrow.items.find((item) => item.id === "wake")!.completion = {
      op: "compare",
      field: "value",
      operator: "lte",
      value: 540,
    };
    const today = structuredClone(baseline);
    today.items.find((item) => item.id === "wake")!.label = "Get up";
    const changes = [
      change(1, "2026-10-16", configurationDiff(baseline, tomorrow)),
      change(2, "2026-10-15", configurationDiff(baseline, today)),
    ];
    const current = resolveConfiguration(
      "owner",
      "2026-10-15",
      changes,
    ).items.find((item) => item.id === "wake")!;
    const future = resolveConfiguration(
      "owner",
      "2026-10-16",
      changes,
    ).items.find((item) => item.id === "wake")!;
    expect(current.label).toBe("Get up");
    expect(current.completion).toMatchObject({ value: 600 });
    expect(future.label).toBe("Get up");
    expect(future.completion).toMatchObject({ value: 540 });
    expect(
      resolveConfiguration("owner", "2026-10-14", changes).items.find(
        (item) => item.id === "wake",
      )!.label,
    ).toBe("Wake-up time");
  });
  it("ignores other accounts and conflicted drafts, and archives only as of the effective date", () => {
    const changes = [
      change(1, "2026-10-16", { blocks: [{ id: "general", deleted: true }] }),
      change(
        2,
        "2026-10-15",
        { blocks: [{ id: "general", title: "Wrong" }] },
        { userId: "another" },
      ),
      change(
        3,
        "2026-10-15",
        { blocks: [{ id: "general", title: "Draft" }] },
        { conflict: "Configuration changed" },
      ),
    ];
    expect(
      resolveConfiguration("owner", "2026-10-15", changes).blocks[0],
    ).toMatchObject({ title: "General" });
    const future = resolveConfiguration("owner", "2026-10-16", changes);
    expect(
      customChecklistProgress(future, {}, "2026-10-16").blocks.general,
    ).toEqual({ completed: 0, total: 0 });
  });
  it("evaluates compound completion, required notes, counts and occurrence fields", () => {
    const item: ChecklistItem = {
      id: "custom",
      blockId: "general",
      label: "Practice",
      kind: "number",
      generation: 1,
      order: 0,
      completion: {
        op: "all",
        rules: [
          { op: "compare", field: "value", operator: "gte", value: 2 },
          {
            op: "not",
            rule: { op: "equals", field: "quality", value: "poor" },
          },
        ],
      },
      followups: [
        {
          id: "quality",
          kind: "choice",
          label: "Quality",
          required: true,
          options: [
            { id: "good", label: "Good" },
            { id: "poor", label: "Poor" },
          ],
        },
        {
          id: "count",
          kind: "counter",
          label: "Sessions",
          defaultValue: 2,
          min: 1,
        },
        {
          id: "details",
          kind: "occurrences",
          label: "Session",
          countField: "count",
          required: true,
        },
      ],
    };
    const answer = { ...emptyItemAnswer(item), value: 2 };
    expect(evaluateItem(item, answer).complete).toBe(false);
    answer.fields.quality = "good";
    answer.fields.details = ["One", "Two"];
    expect(evaluateItem(item, answer).complete).toBe(true);
    expect(evaluateRule({ op: "complete", value: true }, answer, true)).toBe(
      true,
    );
  });
  it("rejects duplicate links, invalid thresholds and incompatible answer payloads", () => {
    const config = configuration();
    config.items.push({ ...getItem("schoolTasks"), id: "duplicate" });
    config.items[0].completion = {
      op: "compare",
      field: "missing",
      operator: "lte",
      value: Number.NaN,
    };
    expect(validateConfiguration(config).join(" ")).toContain(
      "already has a linked question",
    );
    expect(validateConfiguration(config).join(" ")).toContain("unknown field");
    const item = getItem("wake");
    expect(
      validateItemAnswer(item, { ...emptyItemAnswer(item), value: "25:00" }),
    ).not.toEqual([]);
    expect(
      validateItemAnswer(item, { ...emptyItemAnswer(item), value: "09:30" }),
    ).toEqual([]);
  });
  it("derives custom list relevance from work history and retains manual answers", () => {
    const task: Task = {
      id: "a",
      userId: "owner",
      topic: "life",
      title: "Life task",
      parentId: null,
      createdAt: "2026-10-14T12:00:00Z",
      updatedAt: "2026-10-14T12:00:00Z",
      revision: 1,
      completedAt: null,
      deletedAt: null,
    };
    const item = { ...getItem("schoolTasks"), listId: "life" };
    const blank = emptyItemAnswer(item);
    expect(
      listActivityRelevant(
        "life",
        blank,
        "2026-10-15",
        "2026-10-15",
        [task],
        [],
      ),
    ).toBe(true);
    expect(
      listActivityRelevant(
        "life",
        blank,
        "2026-10-13",
        "2026-10-15",
        [task],
        [],
      ),
    ).toBe(false);
    expect(
      listActivityRelevant(
        "life",
        { ...blank, value: false },
        "2026-10-13",
        "2026-10-15",
        [],
        [],
      ),
    ).toBe(true);
  });
});

describe("configuration synchronization limits", () => {
  it("accepts the server rule depth boundary and rejects deeper or wider JSON rules", () => {
    const config = configuration();
    let rule: ChecklistItem["completion"] = { op: "always" };
    for (let depth = 0; depth < 8; depth++) rule = { op: "not", rule };
    config.items[0].completion = rule;
    expect(validateConfiguration(config)).toEqual([]);
    config.items[0].completion = { op: "not", rule };
    expect(validateConfiguration(config).join(" ")).toContain(
      "too deeply nested",
    );
    config.items[0].completion = {
      op: "all",
      rules: Array.from({ length: 51 }, () => ({ op: "always" })),
    };
    expect(validateConfiguration(config)).not.toEqual([]);
    config.items[0].completion = {
      op: "always",
      extra: "not accepted by the server",
    } as unknown as ChecklistItem["completion"];
    expect(validateConfiguration(config).join(" ")).toContain(
      "invalid condition properties",
    );
  });

  it("rejects oversized definition values before they enter the outbox", () => {
    const invalid = [
      (config: ReturnType<typeof configuration>) => {
        config.blocks[0].order = 1000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.lists[0].order = -1000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].generation = 1000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.blocks[0].title = "a".repeat(501);
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].label = "a".repeat(501);
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].helper = "a".repeat(10001);
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].min = -1000000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].max = 1000000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].step = 1000000001;
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].followups[0].ariaLabel = "a".repeat(1001);
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].followups[0].defaultValue = ["wrong type for a note"];
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].followups = Array.from({ length: 51 }, (_, index) => ({
          id: `note-${index}`,
          kind: "note",
          label: "Note",
        }));
      },
      (config: ReturnType<typeof configuration>) => {
        config.items[0].kind = "choice";
        config.items[0].options = Array.from({ length: 101 }, (_, index) => ({
          id: `choice-${index}`,
          label: "Choice",
        }));
      },
    ];
    for (const mutate of invalid) {
      const config = configuration();
      mutate(config);
      expect(validateConfiguration(config), mutate.toString()).not.toEqual([]);
    }
  });

  it("caps complete configuration entity counts without lowering valid built-in counter limits", () => {
    const config = configuration();
    expect(validateConfiguration(config)).toEqual([]);
    expect(
      config.items.find((item) => item.id === "cannabis")!.followups[0].max,
    ).toBe(2147483647);
    config.blocks = Array.from({ length: 201 }, (_, index) => ({
      id: `block-${index}`,
      title: "Block",
      icon: "sun",
      order: index,
    }));
    config.lists = Array.from({ length: 201 }, (_, index) => ({
      id: `list-${index}`,
      title: "List",
      icon: "sun",
      order: index,
    }));
    config.items = Array.from({ length: 2001 }, (_, index) => ({
      id: `item-${index}`,
      label: "Item",
      kind: "checkbox",
      generation: 1,
      blockId: "block-0",
      order: index,
      completion: { op: "equals", field: "value", value: true },
      followups: [],
    }));
    expect(validateConfiguration(config).join(" ")).toContain(
      "Configuration limit exceeded",
    );
  });
});

describe("custom schedules at the local day boundary", () => {
  it("resolves unopened days, inclusive date limits, and weekday rules across the repeated DST hour", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const firstHour = new Date("2026-11-01T01:59:59-04:00");
      const repeatedHour = new Date("2026-11-01T01:59:59-05:00");
      const boundary = new Date("2026-11-01T02:00:00-05:00");
      expect([
        firstHour.getTimezoneOffset(),
        repeatedHour.getTimezoneOffset(),
      ]).toEqual([240, 300]);
      expect(logicalDate(firstHour)).toBe("2026-10-31");
      expect(logicalDate(repeatedHour)).toBe("2026-10-31");
      expect(logicalDate(boundary)).toBe("2026-11-01");
      const scheduled: ConfigChange[] = [
        change(1, "2026-11-01", {
          blocks: [
            {
              id: "practice-block",
              title: "Practice",
              icon: "activity",
              order: 8,
            },
          ],
          items: [
            {
              id: "practice",
              blockId: "practice-block",
              label: "Practice sessions",
              kind: "number",
              generation: 1,
              order: 0,
              schedule: {
                weekdays: [0, 2],
                startDate: "2026-11-01",
                endDate: "2026-11-03",
              },
              completion: {
                op: "compare",
                field: "value",
                operator: "gte",
                value: 2,
              },
              followups: [],
            },
          ],
        }),
        change(2, "2026-11-03", {
          items: [
            {
              id: "practice",
              label: "Three practice sessions",
              completion: {
                op: "compare",
                field: "value",
                operator: "gte",
                value: 3,
              },
            },
          ],
        }),
      ];
      const originalChanges = structuredClone(scheduled);
      const inspect = (date: string) => {
        const config = resolveConfiguration("owner", date, scheduled);
        const progress = customChecklistProgress(
          config,
          {
            "practice@1": {
              generation: 1,
              value: 2,
              fields: {},
              selections: [],
            },
          },
          date,
        );
        return {
          item: config.items.find((item) => item.id === "practice"),
          progress: progress.blocks["practice-block"],
        };
      };
      expect(inspect(logicalDate(repeatedHour)).item).toBeUndefined();
      // Resolve the last day first: no opened-day snapshot or prior evaluation is needed.
      const last = inspect(addDays(logicalDate(boundary), 2));
      expect(last.item?.label).toBe("Three practice sessions");
      expect(last.progress).toEqual({ completed: 0, total: 1 });
      expect(inspect(logicalDate(boundary)).progress).toEqual({
        completed: 1,
        total: 1,
      });
      expect(inspect("2026-11-02").progress).toEqual({
        completed: 0,
        total: 0,
      });
      expect(inspect("2026-11-04").progress).toEqual({
        completed: 0,
        total: 0,
      });
      expect(scheduled).toEqual(originalChanges);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
