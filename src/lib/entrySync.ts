import { emptyData, type DailyData, type DailyEntry } from "./model";
import { db } from "./db";
import { replayDaily } from "./taskDaily";

export interface WireEntry {
  user_id: string;
  logical_date: string;
  data: unknown;
  revision: number;
  created_at: string;
  updated_at: string;
}

// Call inside an entries/outbox transaction, so in-flight local writes cannot
// disappear between reading the queue and replacing the speculative record.
export async function reconcileEntry(e: WireEntry) {
  const pending = await db.outbox
    .where("[userId+logicalDate]")
    .equals([e.user_id, e.logical_date])
    .sortBy("id");
  const entry: DailyEntry = {
    userId: e.user_id,
    logicalDate: e.logical_date,
    data: replayDaily({ ...emptyData(), ...(e.data as DailyData) }, pending),
    revision: e.revision,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
  await db.entries.put(entry);
}
