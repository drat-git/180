import { AutoTextarea } from "./AutoTextarea";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, ImageOff, Trash2, Image as ImageIcon } from "lucide-react";
import { db } from "../lib/db";
import { repository } from "../lib/repository";
import { cacheRemotePhoto } from "../lib/sync";
import type { JournalImage } from "../lib/model";
import { Modal } from "./Controls";
function Photo({
  image,
  onRemove,
  preview,
}: {
  image: JournalImage;
  onRemove: () => void;
  preview: boolean;
}) {
  const cached = useLiveQuery(() => db.blobs.get(image.id), [image.id]);
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!cached) return;
    const next = URL.createObjectURL(cached.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [cached]);
  const fetchPhoto = () => {
    setError("");
    void cacheRemotePhoto(image).catch(() =>
      setError("Connect to download this photo."),
    );
  };
  useEffect(() => {
    if (!preview) fetchPhoto();
  }, [image.id, preview]); // eslint-disable-line
  return (
    <div className="photo">
      <button
        type="button"
        className="photo-preview"
        aria-label="View journal photo"
        onClick={() => (url ? setOpen(true) : fetchPhoto())}
      >
        {url ? (
          <img src={url} alt="Handwritten journal page" />
        ) : (
          <span>
            <ImageOff size={22} />
            {image.localError
              ? "Could not prepare photo"
              : error || "Photo available when online"}
          </span>
        )}
      </button>
      <div className="photo-caption">
        <span>
          {image.localError
            ? "Needs attention"
            : image.revision === 0
              ? cached?.normalized
                ? "Saved locally"
                : "Preparing photo…"
              : "Journal photo"}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label="Remove journal photo"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {image.localError && <p className="small error">{image.localError}</p>}
      {open && (
        <Modal title="Journal photo" onClose={() => setOpen(false)}>
          <img
            className="full-photo"
            src={url}
            alt="Full handwritten journal page"
          />
        </Modal>
      )}
    </div>
  );
}
export function Journal({
  userId,
  date,
  text,
  onText,
  locked,
  onAttempt,
  mutate,
  preview,
}: {
  userId: string;
  date: string;
  text: string;
  onText: (v: string) => void;
  locked: boolean;
  onAttempt: () => void;
  mutate: (action: () => Promise<unknown>) => void;
  preview: boolean;
}) {
  const images =
    useLiveQuery(
      () =>
        db.images
          .where("[userId+logicalDate]")
          .equals([userId, date])
          .filter((i) => !i.deletedAt)
          .sortBy("position"),
      [userId, date],
    ) ?? [];
  const [remove, setRemove] = useState<JournalImage | null>(null);
  return (
    <section className="journal-card">
      <div className="journal-heading">
        <div>
          <h2>Daily journal</h2>
        </div>
        <ImageIcon size={20} />
      </div>
      <label className="sr-only" htmlFor="journal">
        Daily journal
      </label>
      <AutoTextarea
        id="journal"
        className="journal-input"
        placeholder="What did you actually do today?"
        value={text}
        readOnly={locked}
        onFocus={() => {
          if (locked) onAttempt();
        }}
        onChange={(e) => onText(e.target.value)}
      />
      <div className="journal-footer">
        <span>Words, a handwritten page, or both.</span>
        <label
          className="photo-button"
          tabIndex={locked ? -1 : 0}
          role="button"
          onClick={(e) => {
            if (locked) {
              e.preventDefault();
              onAttempt();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (locked) onAttempt();
              else document.getElementById("journal-upload")?.click();
            }
          }}
        >
          <Camera size={17} />
          <span>Add journal photo</span>
          <input
            id="journal-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            multiple
            aria-label="Add journal photo"
            className="sr-only"
            disabled={locked}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              mutate(async () => {
                for (const file of files)
                  await repository.addPhoto(userId, date, file);
              });
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {images.length > 0 && (
        <div className="photos">
          {images.map((image) => (
            <Photo
              key={image.id}
              image={image}
              preview={preview}
              onRemove={() => (locked ? onAttempt() : setRemove(image))}
            />
          ))}
        </div>
      )}
      {remove && (
        <Modal title="Remove this photo?" onClose={() => setRemove(null)}>
          <p>It will be removed from this day and your synced devices.</p>
          <div className="dialog-actions">
            <button onClick={() => setRemove(null)}>Keep photo</button>
            <button
              className="primary"
              onClick={() => {
                mutate(() => repository.removePhoto(userId, remove.id));
                setRemove(null);
              }}
            >
              Remove photo
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
