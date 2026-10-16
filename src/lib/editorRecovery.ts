import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  Configuration,
  TodoListDefinition,
} from "./customizationTypes";

export type EditorRecoveryForm = (
  | {
      kind: "item" | "connection";
      before: ChecklistItem | null;
      value: ChecklistItem;
      isNew: boolean;
    }
  | {
      kind: "block";
      before: ChecklistBlockDefinition | null;
      value: ChecklistBlockDefinition;
      isNew: boolean;
    }
  | {
      kind: "list";
      before: TodoListDefinition | null;
      value: TodoListDefinition;
      isNew: boolean;
    }
) & { conflicts?: string[] };

// A form owns only the fields the user changed. In particular, answer versions
// belong to the current definition and are recalculated when a form is saved.
const derivedFields = new Set(["id", "generation", "legacyKey"]);

function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalValue(value, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const first = left as Record<string, unknown>,
    second = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return [...keys].every((key) => equalValue(first[key], second[key]));
}

function editedFields(before: object | null, value: object): string[] {
  const baseline = (before ?? {}) as Record<string, unknown>,
    next = value as Record<string, unknown>;
  return [...new Set([...Object.keys(baseline), ...Object.keys(next)])].filter(
    (key) => !derivedFields.has(key) && !equalValue(baseline[key], next[key]),
  );
}

function copyField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  if (source[key] === undefined) delete target[key];
  else target[key] = structuredClone(source[key]);
}

export function applyEditorFormChanges<T extends { id: string }>(
  before: T | null,
  value: T,
  current: T,
): T {
  const next = structuredClone(current) as T & Record<string, unknown>;
  const supplied = value as Record<string, unknown>;
  for (const key of editedFields(before, value)) {
    if (key === "deleted" && "deleted" in current && current.deleted === true)
      continue;
    copyField(next, supplied, key);
  }
  return next;
}

function rebaseForm<T extends EditorRecoveryForm>(
  form: T,
  configuration: Configuration,
): T {
  const candidates =
    form.kind === "block"
      ? configuration.blocks
      : form.kind === "list"
        ? configuration.lists
        : configuration.items;
  const current = candidates.find((entity) => entity.id === form.value.id);
  // A genuinely new, unfinished form is expected not to exist in the draft yet.
  if (!current && form.isNew && !form.before) return structuredClone(form);
  if (!current || current.deleted)
    return {
      ...structuredClone(form),
      conflicts: [...new Set([...(form.conflicts ?? []), "__removed"])],
    };
  const before = form.before as Record<string, unknown> | null;
  const local = form.value as unknown as Record<string, unknown>;
  const remote = current as unknown as Record<string, unknown>;
  const conflicts = [
    ...new Set([
      ...(form.conflicts ?? []),
      ...(before
        ? editedFields(form.before, form.value).filter(
            (key) =>
              !equalValue(remote[key], before[key]) &&
              !equalValue(remote[key], local[key]),
          )
        : []),
    ]),
  ];
  return {
    ...structuredClone(form),
    before: structuredClone(current),
    value: applyEditorFormChanges(form.before, form.value, current),
    isNew: false,
    conflicts: conflicts.length ? conflicts : undefined,
  } as T;
}

export function rebaseEditorRecovery(
  state: EditorRecoveryState,
  configuration: Configuration,
  revision: number,
): EditorRecoveryState {
  return {
    ...structuredClone(state),
    baseRevision: revision,
    form: state.form ? rebaseForm(state.form, configuration) : undefined,
    drafts: state.drafts?.map((form) => rebaseForm(form, configuration)),
  };
}

export function resolveEditorFormConflicts<T extends EditorRecoveryForm>(
  form: T,
  keepLocal: boolean,
): T {
  const next = structuredClone(form);
  if (!keepLocal && next.before) {
    for (const key of next.conflicts ?? []) {
      if (key === "__removed" || derivedFields.has(key)) continue;
      copyField(
        next.value as unknown as Record<string, unknown>,
        next.before as unknown as Record<string, unknown>,
        key,
      );
    }
  }
  delete next.conflicts;
  return next;
}

export interface EditorRecoveryState {
  section: "checklist" | "lists";
  selectionId?: string;
  level?: "navigation" | "overview" | "form";
  form?: EditorRecoveryForm;
  drafts?: EditorRecoveryForm[];
  baseRevision: number;
}

export const editorRecoveryKey = (
  userId: string,
  section: EditorRecoveryState["section"],
) => `customization-editor:${section}:${userId}`;

export function readEditorRecovery(
  value: string | undefined,
  section: EditorRecoveryState["section"],
): EditorRecoveryState | undefined {
  if (!value) return;
  try {
    const state = JSON.parse(value) as EditorRecoveryState;
    if (state.section !== section || !Number.isSafeInteger(state.baseRevision))
      return;
    const record = (entry: unknown): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry);
    const choices = (entry: unknown) =>
      entry === undefined ||
      (Array.isArray(entry) &&
        entry.every(
          (choice) =>
            record(choice) &&
            typeof choice.id === "string" &&
            typeof choice.label === "string",
        ));
    const rule = (entry: unknown, depth = 0): boolean => {
      if (!record(entry) || depth > 8) return false;
      if (entry.op === "all" || entry.op === "any")
        return (
          Array.isArray(entry.rules) &&
          entry.rules.every((child) => rule(child, depth + 1))
        );
      if (entry.op === "not") return rule(entry.rule, depth + 1);
      if (entry.op === "always" || entry.op === "never") return true;
      if (entry.op === "complete") return typeof entry.value === "boolean";
      if (typeof entry.field !== "string") return false;
      if (entry.op === "not-empty") return true;
      if (entry.op === "equals")
        return (
          entry.value === null ||
          ["boolean", "number", "string"].includes(typeof entry.value)
        );
      return (
        entry.op === "compare" &&
        typeof entry.value === "number" &&
        ["lt", "lte", "eq", "gte", "gt"].includes(String(entry.operator))
      );
    };
    const schedule = (entry: unknown) =>
      entry === undefined ||
      (record(entry) &&
        (entry.weekdays === undefined ||
          (Array.isArray(entry.weekdays) &&
            entry.weekdays.every((day) => typeof day === "number"))) &&
        (entry.startDate === undefined ||
          typeof entry.startDate === "string") &&
        (entry.endDate === undefined || typeof entry.endDate === "string"));
    const entity = (kind: unknown, entry: unknown): boolean => {
      if (
        !record(entry) ||
        typeof entry.id !== "string" ||
        !Number.isFinite(entry.order) ||
        !schedule(entry.schedule)
      )
        return false;
      if (kind === "block" || kind === "list")
        return (
          typeof entry.title === "string" && typeof entry.icon === "string"
        );
      return (
        typeof entry.label === "string" &&
        typeof entry.blockId === "string" &&
        [
          "checkbox",
          "boolean",
          "number",
          "time",
          "duration",
          "text",
          "choice",
          "tasks",
        ].includes(String(entry.kind)) &&
        Number.isSafeInteger(entry.generation) &&
        rule(entry.completion) &&
        choices(entry.options) &&
        Array.isArray(entry.followups) &&
        entry.followups.every(
          (field) =>
            record(field) &&
            typeof field.id === "string" &&
            typeof field.label === "string" &&
            ["note", "counter", "choice", "occurrences"].includes(
              String(field.kind),
            ) &&
            choices(field.options) &&
            (field.condition === undefined || rule(field.condition)),
        )
      );
    };
    const validForm = (form: EditorRecoveryForm) =>
      record(form) &&
      ["item", "connection", "block", "list"].includes(form.kind) &&
      entity(form.kind, form.value) &&
      (form.before === null || entity(form.kind, form.before)) &&
      typeof form.isNew === "boolean" &&
      (form.conflicts === undefined ||
        (Array.isArray(form.conflicts) &&
          form.conflicts.every((key) => typeof key === "string")));
    if (state.form && !validForm(state.form)) return;
    if (
      state.drafts &&
      (!Array.isArray(state.drafts) || !state.drafts.every(validForm))
    )
      return;
    return state;
  } catch {
    return;
  }
}
