import type { TaskSelection } from "./model";

export type ItemKind =
  | "checkbox"
  | "boolean"
  | "number"
  | "time"
  | "duration"
  | "text"
  | "choice"
  | "tasks";
export type AnswerValue = boolean | number | string | null;
export type FollowupValue = AnswerValue | string[];
/** The main input is addressed as "value"; every other field is a follow-up ID. */
export type Rule =
  | { op: "always" }
  | { op: "never" }
  | { op: "equals"; field: string; value: AnswerValue }
  | { op: "not-empty"; field: string }
  | {
      op: "compare";
      field: string;
      operator: "lt" | "lte" | "eq" | "gte" | "gt";
      value: number;
    }
  | { op: "all" | "any"; rules: Rule[] }
  | { op: "not"; rule: Rule }
  | { op: "complete"; value: boolean };
export type CompletionRule = Rule;
export interface ChoiceOption {
  id: string;
  label: string;
}
export interface Schedule {
  weekdays?: number[];
  startDate?: string;
  endDate?: string;
}
export interface FollowupDefinition {
  id: string;
  ariaLabel?: string;
  preferenceKey?: string;
  addLabel?: string;
  viewLabel?: string;
  kind: "note" | "counter" | "choice" | "occurrences";
  label: string;
  condition?: Rule;
  required?: boolean;
  options?: ChoiceOption[];
  min?: number;
  max?: number;
  defaultValue?: FollowupValue;
  /** Occurrence note arrays are sized by this counter follow-up. */
  countField?: string;
  placeholder?: string;
  initiallyExpanded?: boolean;
  displayChoiceLabel?: boolean;
  resetOnAnswer?: boolean;
}
export interface ChecklistBlockDefinition {
  id: string;
  title: string;
  icon: string;
  order: number;
  deleted?: boolean;
  schedule?: Schedule;
}
export interface ChecklistItem {
  id: string;
  inputId?: string;
  blockId: string;
  label: string;
  kind: ItemKind;
  generation: number;
  order: number;
  schedule?: Schedule;
  helper?: string;
  completion: CompletionRule;
  followups: FollowupDefinition[];
  legacyKey?: string;
  listId?: string;
  visibility?: "relevant" | "always";
  options?: ChoiceOption[];
  min?: number;
  max?: number;
  step?: number;
  deleted?: boolean;
}
export interface TodoListDefinition {
  id: string;
  title: string;
  icon: string;
  order: number;
  deleted?: boolean;
}
export interface Configuration {
  blocks: ChecklistBlockDefinition[];
  items: ChecklistItem[];
  lists: TodoListDefinition[];
}
export type EntityPatch<T extends { id: string }> = Partial<T> & Pick<T, "id">;
export interface ConfigurationPatch {
  blocks?: EntityPatch<ChecklistBlockDefinition>[];
  items?: EntityPatch<ChecklistItem>[];
  lists?: EntityPatch<TodoListDefinition>[];
}
export interface ConfigChange {
  id: string;
  operationId: string;
  userId: string;
  sequence: number;
  baseRevision: number;
  effectiveDate: string;
  patch: ConfigurationPatch;
  createdAt: string;
  revision?: number;
  conflict?: string;
}
export interface ItemAnswer {
  generation: number;
  value: AnswerValue;
  fields: Record<string, FollowupValue>;
  selections: TaskSelection[];
}
/** Keys include the answer schema generation, so incompatible old input remains retained. */
export type ItemAnswers = Record<string, ItemAnswer>;
export interface ItemEvaluation {
  visible: boolean;
  complete: boolean;
  answered: boolean;
  answer: ItemAnswer;
  followups: FollowupDefinition[];
}
export interface CustomChecklistProgress {
  completed: number;
  total: number;
  blocks: Record<string, { completed: number; total: number }>;
}
export interface CustomAnswerRecord {
  userId: string;
  logicalDate: string;
  itemId: string;
  generation: number;
  value: ItemAnswer;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
