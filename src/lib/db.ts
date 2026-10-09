import Dexie, { type EntityTable } from "dexie";
import type {
  DailyEntry,
  JournalImage,
  ImageBlob,
  PendingOperation,
} from "./model";
export class AppDatabase extends Dexie {
  entries!: EntityTable<DailyEntry, "logicalDate">;
  images!: EntityTable<JournalImage, "id">;
  blobs!: EntityTable<ImageBlob, "id">;
  outbox!: EntityTable<PendingOperation, "id">;
  meta!: EntityTable<{ key: string; value: string }, "key">;
  constructor(name = "180-private") {
    super(name);
    this.version(1).stores({
      entries: "[userId+logicalDate],userId",
      images: "id,[userId+logicalDate],userId",
      blobs: "id,userId",
      outbox: "++id,userId,[userId+logicalDate]",
      meta: "key",
    });
  }
}
export const db = new AppDatabase();
