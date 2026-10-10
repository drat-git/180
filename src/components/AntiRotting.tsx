import { AutoTextarea } from "./AutoTextarea";
import { useEffect, useRef, useState } from "react";
import { Compass, Plus, Check } from "lucide-react";
import type { AntiCommand, AntiItem, AntiItemType } from "../lib/model";
import { createId } from "../lib/model";
import { repository } from "../lib/repository";
import { useAntiRotting } from "../lib/useAntiRotting";
import { antiRecap, logActive } from "../lib/antiRotting";
import { ChecklistBlock, Modal } from "./Controls";
import { useMinimized } from "../lib/displayPreferences";

function ActivityRow({
  item,
  didToday,
  busy,
  onLog,
  onComplete,
  onMenu,
}: {
  item: AntiItem;
  didToday: boolean;
  busy: boolean;
  onLog: () => void;
  onComplete: () => Promise<boolean>;
  onMenu: () => void;
}) {
  const [notesHidden, setNotesHidden] = useMinimized(
    `anti-notes:${item.id}`,
    true,
  );
  const [optimisticComplete, setOptimisticComplete] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    if (
      optimisticComplete !== null &&
      !!item.completedAt === optimisticComplete
    )
      setOptimisticComplete(null);
  }, [item.completedAt, optimisticComplete]);
  const completed = optimisticComplete ?? !!item.completedAt;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null),
    held = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => cancel, []);
  return (
    <li
      className={`anti-item ${completed ? "is-complete" : ""}`}
      role="group"
      aria-label={`Activity ${item.title}`}
      tabIndex={busy ? -1 : 0}
      title="Hold for options, or press Shift+F10 when focused."
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || busy) return;
        if (
          e.key === "ContextMenu" ||
          (e.shiftKey && e.key === "F10") ||
          e.key === "Enter"
        ) {
          e.preventDefault();
          onMenu();
        }
      }}
      onPointerDown={(e) => {
        held.current = false;
        if (
          busy ||
          e.button !== 0 ||
          (e.target as Element).closest("button,input")
        )
          return;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          held.current = true;
          onMenu();
        }, 500);
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onPointerMove={(e) => {
        if (
          start.current &&
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
            8
        )
          cancel();
      }}
      onClickCapture={(e) => {
        if (held.current) {
          e.preventDefault();
          e.stopPropagation();
          held.current = false;
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
        if (!busy) onMenu();
      }}
    >
      <div className="anti-row">
        {item.itemType === "one-time" && (
          <input
            type="checkbox"
            aria-label={`Complete activity ${item.title}`}
            checked={completed}
            disabled={busy || optimisticComplete !== null}
            onChange={(e) => {
              setOptimisticComplete(e.target.checked);
              void onComplete().then((ok) => {
                if (!ok) setOptimisticComplete(null);
              });
            }}
          />
        )}
        <div className="task-copy">
          <span className="task-title">{item.title}</span>
        </div>
        <button
          className={`anti-log-button ${didToday ? "selected" : ""}`}
          disabled={busy}
          aria-label={`${didToday ? "Remove today’s log for" : "Did this:"} ${item.title}`}
          aria-pressed={didToday}
          onClick={onLog}
        >
          {didToday && <Check size={13} />}{" "}
          {didToday ? "Did today" : "Did this"}
        </button>
      </div>
      {!!item.notes && (
        <div className="anti-notes">
          <button
            className="text-button"
            aria-expanded={!notesHidden}
            onClick={() => setNotesHidden(!notesHidden)}
          >
            {notesHidden ? "View notes" : "Hide notes"}
          </button>
          {!notesHidden && <p>{item.notes}</p>}
        </div>
      )}
    </li>
  );
}
export function AntiRotting({
  userId,
  today,
  onSaving,
  onError,
  blocked,
}: {
  userId: string;
  today: string;
  onSaving: (delta: number) => void;
  onError: (message: string) => void;
  blocked: boolean;
}) {
  const { visible, logs } = useAntiRotting(userId);
  const todayLogs = logs.filter((l) => l.logicalDate === today && logActive(l));
  const [form, setForm] = useState<AntiItem | "new" | null>(null),
    [menu, setMenu] = useState<AntiItem | null>(null),
    [remove, setRemove] = useState<AntiItem | null>(null);
  const [title, setTitle] = useState(""),
    [notes, setNotes] = useState(""),
    [itemType, setItemType] = useState<AntiItemType>("reusable"),
    [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const draftId = useRef("");
  async function mutate(
    command: Omit<AntiCommand, "at" | "logicalDate" | "timezone">,
  ) {
    if (writing.current || blocked) return false;
    writing.current = true;
    setBusy(true);
    onSaving(1);
    try {
      await repository.antiOperation(userId, command);
      return true;
    } catch (e) {
      onError(
        e instanceof Error ? e.message : "Could not save the activity locally.",
      );
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
      onSaving(-1);
    }
  }
  function openForm(item: AntiItem | "new") {
    draftId.current = item === "new" ? createId() : item.id;
    setTitle(item === "new" ? "" : item.title);
    setNotes(item === "new" ? "" : item.notes);
    setItemType(item === "new" ? "reusable" : item.itemType);
    setForm(item);
  }
  return (
    <ChecklistBlock
      title="Anti Rotting"
      preferenceKey="anti-rotting"
      icon={<Compass size={18} />}
    >
      <p className="small anti-intro">Something to do instead of scrolling.</p>
      <ul className="anti-list">
        {visible.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            didToday={todayLogs.some((l) => l.itemId === item.id)}
            busy={busy || blocked}
            onLog={() =>
              void mutate({
                itemId: item.id,
                action: "log",
                logged: !todayLogs.some((l) => l.itemId === item.id),
              })
            }
            onComplete={() =>
              mutate({
                itemId: item.id,
                action: "complete",
                completed: !item.completedAt,
              })
            }
            onMenu={() => setMenu(item)}
          />
        ))}
      </ul>
      <button
        className="text-button anti-add"
        disabled={busy || blocked}
        onClick={() => openForm("new")}
      >
        <Plus size={15} />
        Add activity
      </button>
      {menu && (
        <Modal title="Activity options" onClose={() => setMenu(null)}>
          <p>{menu.title}</p>
          <div className="dialog-actions">
            <button
              onClick={() => {
                openForm(menu);
                setMenu(null);
              }}
            >
              Edit
            </button>
            <button
              className="danger"
              onClick={() => {
                setRemove(menu);
                setMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {form && (
        <Modal
          title={form === "new" ? "Add activity" : "Edit activity"}
          onClose={() => setForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate({
                itemId: draftId.current,
                action: form === "new" ? "create" : "edit",
                title,
                notes,
                itemType,
              }).then((ok) => {
                if (ok) setForm(null);
              });
            }}
          >
            <label>
              Activity title
              <input
                autoFocus
                aria-label="Activity title"
                maxLength={500}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Notes (optional)
              <AutoTextarea
                aria-label="Activity notes"
                rows={2}
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Activity type
              <select
                aria-label="Activity type"
                value={itemType}
                onChange={(e) => setItemType(e.target.value as AntiItemType)}
                disabled={busy}
              >
                <option value="reusable">Reusable</option>
                <option value="one-time">One-time</option>
              </select>
            </label>
            <p className="small">
              Reusable ideas stay available. One-time activities have a separate
              completion checkbox.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || blocked || !title.trim()}
              >
                Save activity
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Delete activity?" onClose={() => setRemove(null)}>
          <p>
            Delete “{remove.title}”? Recorded days and completion history will
            remain.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setRemove(null)}>Cancel</button>
            <button
              className="danger"
              disabled={busy || blocked}
              onClick={() =>
                void mutate({ itemId: remove.id, action: "delete" }).then(
                  (ok) => {
                    if (ok) setRemove(null);
                  },
                )
              }
            >
              Delete activity
            </button>
          </div>
        </Modal>
      )}
    </ChecklistBlock>
  );
}
export function AntiRottingRecap({
  userId,
  date,
  today,
}: {
  userId: string;
  date: string;
  today: string;
}) {
  const { logs, events } = useAntiRotting(userId);
  const rows = antiRecap(logs, events, date);
  if (date >= today || !rows.length) return null;
  return (
    <ChecklistBlock
      title="Anti Rotting"
      preferenceKey="anti-recap"
      icon={<Compass size={18} />}
    >
      <ul className="anti-recap" aria-label="Anti Rotting recap">
        {rows.map((row) => (
          <li key={row.itemId}>
            <div>
              <span>{row.title}</span>
              {row.notes && <p className="small">{row.notes}</p>}
            </div>
            <span className={`anti-status ${row.completed ? "completed" : ""}`}>
              {row.completed ? "Completed" : "Worked on"}
            </span>
          </li>
        ))}
      </ul>
    </ChecklistBlock>
  );
}
