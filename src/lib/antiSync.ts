import { db } from "./db";
import { supabase } from "./supabase";
import { applyAntiCommand } from "./antiRotting";
import type { AntiItem, AntiLog, AntiEvent, PendingOperation } from "./model";
import type { Json } from "./database.types";
interface State {
  items: AntiItem[];
  logs: AntiLog[];
  events: AntiEvent[];
}
export async function mergeAnti(
  userId: string,
  remote: State,
  acknowledged?: PendingOperation,
) {
  await db.transaction(
    "rw",
    [db.antiItems, db.antiLogs, db.antiEvents, db.outbox],
    async () => {
      if (acknowledged) {
        await db.outbox.delete(acknowledged.id!);
        // The RPC returns every log for the affected item, including tombstones.
        // Remove speculative logs rejected by a concurrent remote deletion.
        await db.antiLogs
          .where("[userId+itemId]")
          .equals([userId, acknowledged.antiCommand!.itemId])
          .delete();
        await db.antiEvents
          .where("operationId")
          .equals(acknowledged.operationId)
          .and((e) => e.userId === userId)
          .delete();
      }
      await db.antiItems.bulkPut(remote.items);
      await db.antiLogs.bulkPut(remote.logs);
      await db.antiEvents.bulkPut(remote.events);
      let state: State = {
        items: await db.antiItems.where("userId").equals(userId).toArray(),
        logs: await db.antiLogs.where("userId").equals(userId).toArray(),
        events: await db.antiEvents.where("userId").equals(userId).toArray(),
      };
      for (const op of await db.outbox
        .where("userId")
        .equals(userId)
        .sortBy("id"))
        if (op.kind === "anti-rotting")
          state = applyAntiCommand(
            state,
            userId,
            op.operationId,
            op.antiCommand!,
          );
      await db.antiItems.bulkPut(state.items);
      await db.antiLogs.bulkPut(state.logs);
      await db.antiEvents.bulkPut(state.events);
    },
  );
}
export async function pushAnti(userId: string, op: PendingOperation) {
  const { data, error } = await supabase.rpc("apply_anti_operation", {
    p_operation: op.operationId,
    p_command: op.antiCommand as unknown as Json,
  });
  if (error) throw error;
  await mergeAnti(userId, data as unknown as State, op);
}
export async function pullAnti(userId: string) {
  async function rows<T>(
    table: "anti_rotting_items" | "anti_rotting_logs" | "anti_rotting_events",
  ): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from(table)
        .select("data")
        .eq("user_id", userId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      result.push(...data.map((row) => row.data as unknown as T));
      if (data.length < 500) break;
    }
    return result;
  }
  const [items, logs, events] = await Promise.all([
    rows<AntiItem>("anti_rotting_items"),
    rows<AntiLog>("anti_rotting_logs"),
    rows<AntiEvent>("anti_rotting_events"),
  ]);
  await mergeAnti(userId, { items, logs, events });
}
