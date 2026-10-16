import Dexie, { type EntityTable } from "dexie";
import type { ConfigChange, CustomAnswerRecord } from "./customizationTypes";
import { accountProfileKey, legacyAccountProfile } from "./accountProfile";
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
  configurations!: EntityTable<ConfigChange, "id">;
  customAnswers!: EntityTable<CustomAnswerRecord, "itemId">;
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
    this.version(4).stores({
      configurations: "id,userId,[userId+effectiveDate],sequence",
      customAnswers:
        "[userId+logicalDate+itemId+generation],userId,[userId+logicalDate]",
    });
    this.version(5)
      .stores({})
      .upgrade(async (transaction) => {
        const meta = transaction.table("meta");
        const cached = await meta.get("active-account");
        if (cached) {
          try {
            const account = JSON.parse(cached.value);
            if (
              typeof account.id === "string" &&
              !account.id.startsWith("local-demo:")
            )
              await meta.put({
                key: accountProfileKey(account.id),
                value: JSON.stringify(legacyAccountProfile(account.id)),
              });
          } catch {
            /* Leave an invalid cached account locked. */
          }
        }
      });
  }
}
export const db = new AppDatabase();
