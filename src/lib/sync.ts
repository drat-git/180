import { db } from "./db";
import { repository } from "./repository";
import { supabase } from "./supabase";
import { pushAnti, pullAnti } from "./antiSync";
import { pushTask, pullTasks } from "./taskSync";
import { logicalDate } from "./dates";
import {
  emptyData,
  type DailyData,
  type DailyEntry,
  type JournalImage,
  type PendingOperation,
} from "./model";
export type SyncState =
  "local" | "syncing" | "synced" | "offline" | "auth" | "error";
type WireEntry = {
  user_id: string;
  logical_date: string;
  data: unknown;
  revision: number;
  created_at: string;
  updated_at: string;
};
type WireImage = {
  id: string;
  user_id: string;
  logical_date: string;
  storage_path: string;
  position: number;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};
const entryFromWire = (e: WireEntry): DailyEntry => ({
  userId: e.user_id,
  logicalDate: e.logical_date,
  data: { ...emptyData(), ...(e.data as DailyData) },
  revision: e.revision,
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});
const imageFromWire = (i: WireImage): JournalImage => ({
  id: i.id,
  userId: i.user_id,
  logicalDate: i.logical_date,
  storagePath: i.storage_path,
  position: i.position,
  revision: i.revision,
  deletedAt: i.deleted_at,
  createdAt: i.created_at,
  updatedAt: i.updated_at,
});
export class SyncEngine {
  state: SyncState = "local";
  error = "";
  onState: () => void = () => {};
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private backoff = 1500;
  constructor(private userId: string) {}
  private set(state: SyncState, error = "") {
    this.state = state;
    this.error = error;
    this.onState();
  }
  start() {
    this.stopped = false;
    repository.onChange = () => this.schedule(600);
    window.addEventListener("online", this.wake);
    window.addEventListener("offline", this.offline);
    window.addEventListener("focus", this.wake);
    document.addEventListener("visibilitychange", this.visible);
    this.interval = setInterval(() => {
      if (document.visibilityState === "visible") this.schedule(0);
    }, 30000);
    this.schedule(0);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    repository.onChange = () => {};
    window.removeEventListener("online", this.wake);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("focus", this.wake);
    document.removeEventListener("visibilitychange", this.visible);
  }
  private wake = () => this.schedule(0);
  private offline = () => this.set("offline");
  private visible = () => {
    if (document.visibilityState === "visible") this.schedule(0);
  };
  schedule(delay = 0) {
    if (this.stopped) return;
    this.set(navigator.onLine ? "local" : "offline");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }
  private async acknowledged(op: PendingOperation, server?: WireEntry) {
    await db.transaction("rw", db.entries, db.outbox, async () => {
      if (op.id !== undefined) await db.outbox.delete(op.id);
      if (server) {
        const data = entryFromWire(server);
        const pending = await db.outbox
          .where("[userId+logicalDate]")
          .equals([this.userId, op.logicalDate])
          .sortBy("id");
        for (const p of pending)
          if (p.kind === "entry") Object.assign(data.data, p.patch);
        await db.entries.put(data);
      }
    });
  }
  async run() {
    if (this.running || this.stopped) return;
    if (!navigator.onLine) {
      this.set("offline");
      return;
    }
    this.running = true;
    try {
      const work = async () => {
        if (this.stopped) return;
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session || session.user.id !== this.userId) {
          this.set("auth");
          return;
        }
        this.set("syncing");
        let queue = await db.outbox
          .where("userId")
          .equals(this.userId)
          .sortBy("id");
        for (const op of queue) {
          if (this.stopped) return;
          // Travel can temporarily put a recorded date ahead of local today.
          // Keep that operation queued without blocking accessible-day edits.
          if (
            op.kind !== "task" &&
            op.kind !== "anti-rotting" &&
            op.logicalDate > logicalDate()
          )
            continue;
          await this.push(op);
        }
        await this.pull();
        queue = await db.outbox
          .where("userId")
          .equals(this.userId)
          .sortBy("id");
        this.backoff = 1500;
        this.set(queue.length ? "local" : "synced");
        if (
          queue.some(
            (op) =>
              op.kind === "task" ||
              op.kind === "anti-rotting" ||
              op.logicalDate <= logicalDate(),
          )
        )
          this.schedule(600);
      };
      // Web Locks serializes workers across tabs. Without it, operation receipts still protect retries.
      if (navigator.locks)
        await navigator.locks.request(`180-sync-${this.userId}`, work);
      else await work();
    } catch (error) {
      const e = error as { message?: string; status?: number; code?: string };
      const auth =
        e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303";
      this.set(
        auth ? "auth" : "error",
        e.message || "Could not sync. Your local changes are safe.",
      );
      if (!auth && !this.stopped) {
        this.timer = setTimeout(() => void this.run(), this.backoff);
        this.backoff = Math.min(60000, this.backoff * 2);
      }
    } finally {
      this.running = false;
    }
  }
  private async push(op: PendingOperation) {
    if (op.kind === "anti-rotting") {
      await pushAnti(this.userId, op);
      return;
    }
    if (op.kind === "task") {
      await pushTask(this.userId, op);
      return;
    }
    if (op.kind === "entry") {
      const { data, error } = await supabase.rpc("apply_entry_patch", {
        p_date: op.logicalDate,
        p_operation: op.operationId,
        p_patch: op.patch as never,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (error) throw error;
      await this.acknowledged(op, data as unknown as WireEntry);
      return;
    }
    const image = await db.images.get(op.imageId!);
    if (!image || image.userId !== this.userId)
      throw new Error("The local photo record is missing.");
    if (op.kind === "photo-add") {
      if (image.deletedAt) {
        await this.acknowledged(op);
        return;
      }
      const blob = await repository.preparePhoto(this.userId, image.id);
      const uploaded = await supabase.storage
        .from("journal")
        .upload(image.storagePath, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (
        uploaded.error &&
        !(
          /already exists|duplicate/i.test(uploaded.error.message) ||
          uploaded.error.statusCode === "409"
        )
      )
        throw uploaded.error;
      const { data, error } = await supabase.rpc("apply_image_operation", {
        p_date: op.logicalDate,
        p_operation: op.operationId,
        p_image: image.id,
        p_position: image.position,
        p_delete: false,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (error) throw error;
      const serverImage = imageFromWire(data as unknown as WireImage);
      if (serverImage.deletedAt) {
        // Another device may have deleted this image during an upload retry.
        // Remove the newly uploaded object before acknowledging the tombstone.
        const { error: removeError } = await supabase.storage
          .from("journal")
          .remove([image.storagePath]);
        if (removeError) throw removeError;
      }
      await db.transaction("rw", db.images, db.outbox, db.blobs, async () => {
        const current = await db.images.get(image.id);
        if (current)
          await db.images.put({
            ...serverImage,
            deletedAt: current.deletedAt ?? serverImage.deletedAt,
          });
        if (serverImage.deletedAt) await db.blobs.delete(image.id);
        if (op.id !== undefined) await db.outbox.delete(op.id);
      });
    } else {
      const { data, error } = await supabase.rpc("apply_image_operation", {
        p_date: op.logicalDate,
        p_operation: op.operationId,
        p_image: image.id,
        p_position: image.position,
        p_delete: true,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (error) throw error;
      await db.images.put(imageFromWire(data as unknown as WireImage));
      const { error: removeError } = await supabase.storage
        .from("journal")
        .remove([image.storagePath]);
      if (removeError) throw removeError;
      await db.blobs.delete(image.id);
      await this.acknowledged(op);
    }
  }
  private async pull() {
    await pullTasks(this.userId);
    await pullAnti(this.userId);
    const [
      { data: entries, error: entryError },
      { data: images, error: imageError },
    ] = await Promise.all([
      supabase
        .from("daily_entries")
        .select("logical_date,revision")
        .eq("user_id", this.userId),
      supabase.from("journal_images").select("*").eq("user_id", this.userId),
    ]);
    if (entryError) throw entryError;
    if (imageError) throw imageError;
    const dates: string[] = [];
    for (const remote of entries ?? []) {
      const local = await db.entries.get([this.userId, remote.logical_date]);
      if (!local || local.revision !== remote.revision)
        dates.push(remote.logical_date);
    }
    if (dates.length) {
      const { data, error } = await supabase
        .from("daily_entries")
        .select("*")
        .eq("user_id", this.userId)
        .in("logical_date", dates);
      if (error) throw error;
      await db.transaction("rw", db.entries, db.outbox, async () => {
        for (const wire of data ?? []) {
          const entry = entryFromWire(wire);
          const pending = await db.outbox
            .where("[userId+logicalDate]")
            .equals([this.userId, entry.logicalDate])
            .sortBy("id");
          for (const op of pending)
            if (op.kind === "entry") Object.assign(entry.data, op.patch);
          await db.entries.put(entry);
        }
      });
    }
    for (const wire of images ?? []) {
      const image = imageFromWire(wire);
      await db.transaction("rw", db.images, db.outbox, db.blobs, async () => {
        const local = await db.images.get(image.id);
        const pending = await db.outbox
          .where("userId")
          .equals(this.userId)
          .filter((op) => op.imageId === image.id)
          .count();
        if (!pending && (!local || local.revision !== image.revision)) {
          await db.images.put(image);
          if (image.deletedAt) await db.blobs.delete(image.id);
        }
      });
    }
  }
}
export async function cacheRemotePhoto(image: JournalImage): Promise<void> {
  if ((await db.blobs.get(image.id)) || image.deletedAt || !navigator.onLine)
    return;
  const { data, error } = await supabase.storage
    .from("journal")
    .download(image.storagePath);
  if (error) throw error;
  await db.transaction("rw", db.images, db.blobs, async () => {
    const current = await db.images.get(image.id);
    if (current && !current.deletedAt)
      await db.blobs.put({
        id: image.id,
        userId: image.userId,
        blob: data,
        normalized: true,
      });
  });
}
