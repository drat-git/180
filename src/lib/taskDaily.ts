import type {
  DailyData,
  EntryPatch,
  PendingOperation,
  SelectionProvenance,
  Task,
  TaskCommand,
  TaskDailyChange,
  TaskEvent,
  TaskSelection,
} from "./model";

const manual = (node: SelectionProvenance) => node.manual !== false;
const retained = (node: SelectionProvenance) =>
  manual(node) || !!node.automatic;

// Only the explicitly checked leaf contributes work. Derived parent transitions
// provide history, never an independent selection or yesterday's siblings.
export function taskDailyChange(
  tasks: Task[],
  events: TaskEvent[],
  command: TaskCommand,
): TaskDailyChange | undefined {
  if (!command.recordDaily || command.action !== "complete") return;
  const event = events.find((e) => e.taskId === command.taskId);
  if (!event || (event.topic !== "school" && event.topic !== "career")) return;
  const parent = tasks.find((t) => t.id === (event.parentId ?? event.taskId));
  if (!parent) return;
  return {
    topic: event.topic,
    parent: { taskId: parent.id, title: parent.title },
    ...(event.parentId
      ? { child: { taskId: event.taskId, title: event.title } }
      : {}),
    completed: event.type === "completed",
  };
}

export function mergeTaskSelections(
  source: TaskSelection[],
  change: TaskDailyChange,
  operationId: string,
): TaskSelection[] {
  const result = source.map((s) => ({
    ...s,
    children: s.children.map((c) => ({ ...c })),
  }));
  let parent = result.find((s) => s.taskId === change.parent.taskId);
  if (change.completed) {
    if (!parent) {
      parent = { ...change.parent, manual: false, children: [] };
      result.push(parent);
    }
    if (change.child) {
      let child = parent.children.find(
        (c) => c.taskId === change.child!.taskId,
      );
      if (!child) {
        child = { ...change.child, manual: false };
        parent.children.push(child);
      }
      child.automatic = operationId;
    } else parent.automatic = operationId;
  } else if (parent) {
    const node = change.child
      ? parent.children.find((c) => c.taskId === change.child!.taskId)
      : parent;
    if (node) delete node.automatic;
    parent.children = parent.children.filter(retained);
    if (!retained(parent) && !parent.children.length)
      return result.filter((s) => s !== parent);
  }
  return result;
}

export function taskDailyPatch(
  data: DailyData,
  change: TaskDailyChange,
  operationId: string,
): EntryPatch {
  const field = `${change.topic}TasksWorkedOn` as const;
  const selections = mergeTaskSelections(data[field], change, operationId);
  // An undo with no automatic contribution must leave manual answers alone.
  if (
    !change.completed &&
    JSON.stringify(selections) === JSON.stringify(data[field])
  )
    return {};
  return {
    [field]: selections,
    [`${change.topic}TasksStatus`]:
      change.completed || selections.length > 0 ? true : null,
  };
}

// Outbox order is shared by task contributions and intentional manual patches.
// Replaying stored intent does not depend on already-speculative task state.
export function replayDaily(
  data: DailyData,
  pending: PendingOperation[],
): DailyData {
  let next = { ...data };
  for (const op of pending) {
    if (op.kind === "entry") next = { ...next, ...op.patch };
    else if (op.kind === "task" && op.taskDailyChange)
      next = {
        ...next,
        ...taskDailyPatch(next, op.taskDailyChange, op.operationId),
      };
  }
  return next;
}
