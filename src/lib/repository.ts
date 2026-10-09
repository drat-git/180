import { db, type AppDatabase } from "./db";
import {
  emptyData,
  createId,
  type DailyEntry,
  type EntryPatch,
  type JournalImage,
} from "./model";
import { normalizePhoto } from "./photos";
export interface EntryRepository {
  getDay(userId: string, date: string): Promise<DailyEntry | undefined>;
  patchDay(userId: string, date: string, patch: EntryPatch): Promise<void>;
  addPhoto(userId: string, date: string, file: File): Promise<string>;
  removePhoto(userId: string, id: string): Promise<void>;
}
export class LocalRepository implements EntryRepository {
  onChange: () => void = () => {};
  private unsaved = new Map<string, EntryPatch>();
  hasUnsaved(userId: string) {
    return [...this.unsaved.keys()].some((key) => key.startsWith(userId + "|"));
  }
  unsavedFor(userId: string, date: string) {
    return this.unsaved.get(userId + "|" + date) ?? {};
  }
  async retryUnsaved(userId: string) {
    for (const key of [...this.unsaved.keys()])
      if (key.startsWith(userId + "|"))
        await this.patchDay(userId, key.slice(userId.length + 1), {});
  }
  constructor(public database: AppDatabase = db) {}
  getDay(userId: string, date: string) {
    return this.database.entries.get([userId, date]);
  }
  async patchDay(userId: string, date: string, patch: EntryPatch) {
    const now = new Date().toISOString();
    const key = userId + "|" + date;
    patch = { ...this.unsaved.get(key), ...patch };
    this.unsaved.set(key, patch);
    await this.database.transaction(
      "rw",
      this.database.entries,
      this.database.outbox,
      async () => {
        const entry = await this.getDay(userId, date);
        await this.database.entries.put({
          ...entry,
          userId,
          logicalDate: date,
          data: { ...emptyData(), ...entry?.data, ...patch },
          revision: entry?.revision ?? 0,
          createdAt: entry?.createdAt ?? now,
          updatedAt: now,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: date,
          kind: "entry",
          patch,
          createdAt: now,
        });
      },
    );
    const remaining = { ...this.unsaved.get(key) };
    for (const field of Object.keys(patch) as (keyof EntryPatch)[])
      if (remaining[field] === patch[field]) delete remaining[field];
    if (Object.keys(remaining).length) this.unsaved.set(key, remaining);
    else this.unsaved.delete(key);
    this.onChange();
  }
  async addPhoto(userId: string, date: string, file: File) {
    if (!(
      /^(image\/(jpeg|png|webp|heic|heif))$/i.test(file.type) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
    ))
      throw new Error("Choose a JPEG, PNG, WebP, or HEIC photo.");
    if (file.size > 50 * 1024 * 1024)
      throw new Error("Choose a photo smaller than 50 MB.");
    const id = createId(),
      now = new Date().toISOString();
    if (!(await this.getDay(userId, date)))
      await this.patchDay(userId, date, {});
    const existing = await this.database.images
      .where("[userId+logicalDate]")
      .equals([userId, date])
      .toArray();
    const image: JournalImage = {
      id,
      userId,
      logicalDate: date,
      storagePath: `${userId}/${date}/${id}.jpg`,
      position: Math.max(0, ...existing.map((i) => i.position)) + 1,
      revision: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Persist the original before conversion; a crash cannot erase a selected photo.
    await this.database.transaction(
      "rw",
      this.database.images,
      this.database.blobs,
      this.database.outbox,
      async () => {
        await this.database.images.put(image);
        const type = /\.hei[cf]$/i.test(file.name) ? "image/heic" : file.type;
        await this.database.blobs.put({
          id,
          userId,
          blob: new Blob([file], { type }),
          normalized: false,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: date,
          kind: "photo-add",
          imageId: id,
          createdAt: now,
        });
      },
    );
    try {
      await this.preparePhoto(userId, id);
    } catch (error) {
      await this.database.images.update(id, {
        localError:
          error instanceof Error ? error.message : "Photo conversion failed.",
      });
    }
    this.onChange();
    return id;
  }
  async preparePhoto(userId: string, id: string) {
    const cached = await this.database.blobs.get(id);
    if (!cached || cached.userId !== userId)
      throw new Error("The local photo is missing.");
    if (cached.normalized) return cached.blob;
    const blob = await normalizePhoto(cached.blob);
    await this.database.blobs.put({ ...cached, blob, normalized: true });
    await this.database.images.update(id, { localError: undefined });
    return blob;
  }
  async removePhoto(userId: string, id: string) {
    const image = await this.database.images.get(id);
    if (!image || image.userId !== userId) return;
    const now = new Date().toISOString();
    await this.database.transaction(
      "rw",
      this.database.images,
      this.database.outbox,
      async () => {
        await this.database.images.update(id, {
          deletedAt: now,
          updatedAt: now,
          localError: undefined,
        });
        await this.database.outbox.add({
          operationId: createId(),
          userId,
          logicalDate: image.logicalDate,
          kind: "photo-delete",
          imageId: id,
          createdAt: now,
        });
      },
    );
    this.onChange();
  }
}
export const repository = new LocalRepository();
