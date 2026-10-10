import { db } from "./db";
import { supabase } from "./supabase";
import type { Json, Tables } from "./database.types";
import type { PendingOperation, Task, TaskEvent } from "./model";
import { applyTaskCommand } from "./tasks";

type WireTask = Tables<"tasks">;
type WireEvent = Tables<"task_events">;
export const taskFromWire = (t: WireTask): Task => ({
  id: t.id,
  userId: t.user_id,
  topic: t.topic as Task["topic"],
  parentId: t.parent_id,
  title: t.title,
  completedAt: t.completed_at ? new Date(t.completed_at).toISOString() : null,
  deletedAt: t.deleted_at ? new Date(t.deleted_at).toISOString() : null,
  revision: t.revision,
  createdAt: new Date(t.created_at).toISOString(),
  updatedAt: new Date(t.updated_at).toISOString(),
});
export const eventFromWire = (e: WireEvent): TaskEvent => ({
  id: e.id,
  operationId: e.operation_id,
  userId: e.user_id,
  taskId: e.task_id,
  parentId: e.parent_id,
  topic: e.topic as Task["topic"],
  title: e.title,
  type: e.event_type as TaskEvent["type"],
  at: new Date(e.occurred_at).toISOString(),
  logicalDate: e.logical_date,
  timezone: e.timezone,
});

async function merge(
  userId: string,
  remoteTasks: WireTask[],
  remoteEvents: WireEvent[],
  acknowledged?: PendingOperation,
) {
  await db.transaction("rw", db.tasks, db.taskEvents, db.outbox, async () => {
    if (acknowledged) {
      await db.outbox.delete(acknowledged.id!);
      await db.taskEvents
        .where("operationId")
        .equals(acknowledged.operationId)
        .and((e) => e.userId === userId)
        .delete();
      if (
        acknowledged.taskCommand?.action === "create" &&
        !remoteTasks.some((t) => t.id === acknowledged.taskCommand!.taskId)
      ) {
        await db.tasks
          .where("id")
          .equals(acknowledged.taskCommand.taskId)
          .and((t) => t.userId === userId)
          .delete();
      }
    }
    await db.tasks.bulkPut(remoteTasks.map(taskFromWire));
    await db.taskEvents.bulkPut(remoteEvents.map(eventFromWire));
    let tasks = await db.tasks.where("userId").equals(userId).toArray();
    const pending = await db.outbox.where("userId").equals(userId).sortBy("id");
    for (const op of pending) {
      if (op.kind !== "task") continue;
      const result = applyTaskCommand(
        tasks,
        userId,
        op.operationId,
        op.taskCommand!,
      );
      tasks = result.tasks;
      await db.taskEvents.bulkPut(result.events);
    }
    await db.tasks.bulkPut(tasks);
  });
}
export async function pushTask(userId: string, op: PendingOperation) {
  const { data, error } = await supabase.rpc("apply_task_operation", {
    p_operation: op.operationId,
    p_command: op.taskCommand as unknown as Json,
  });
  if (error) throw error;
  const result = data as unknown as { tasks: WireTask[]; events: WireEvent[] };
  await merge(userId, result.tasks, result.events, op);
}
export async function pullTasks(userId: string) {
  async function rows(table: "tasks" | "task_events") {
    const collected: (WireTask | WireEvent)[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      collected.push(...(data as (WireTask | WireEvent)[]));
      if (data.length < 500) break;
    }
    return collected;
  }
  const [tasks, events] = await Promise.all([
    rows("tasks"),
    rows("task_events"),
  ]);
  await merge(userId, tasks as WireTask[], events as WireEvent[]);
}
