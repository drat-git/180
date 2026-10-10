import Dexie, { type EntityTable } from "dexie";
import type {
  AntiItem,
  AntiLog,
  AntiEvent,
  Task,
  TaskEvent,
  DailyEntry,
  JournalImage,
  ImageBlob,
  PendingOperation,
} from "./model";
export class AppDatabase extends Dexie {
  antiItems!: EntityTable<AntiItem, "id">;
  antiLogs!: EntityTable<AntiLog, "id">;
  antiEvents!: EntityTable<AntiEvent, "id">;
  tasks!: EntityTable<Task, "id">;
  taskEvents!: EntityTable<TaskEvent, "id">;
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
    this.version(2).stores({
      tasks: "id,userId,[userId+topic],parentId",
      taskEvents: "id,userId,[userId+taskId],[userId+logicalDate],operationId",
    });
    this.version(3).stores({
      antiItems: "id,userId",
      antiLogs: "id,userId,[userId+logicalDate],[userId+itemId]",
      antiEvents: "id,userId,[userId+logicalDate],operationId",
    });
  }
}
export const db = new AppDatabase();
