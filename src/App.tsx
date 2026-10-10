import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Check,
  CloudOff,
  RefreshCw,
  LogOut,
  ArrowRight,
  Settings2,
  WifiOff,
} from "lucide-react";
import {
  logicalDate,
  dayNumber,
  dateLabel,
  addDays,
  canNavigate,
} from "./lib/dates";
import { START_DATE } from "./lib/model";
import { db } from "./lib/db";
import { repository } from "./lib/repository";
import { SyncEngine, type SyncState } from "./lib/sync";
import { useAuth } from "./lib/auth";
import { DailyCheckIn } from "./components/DailyCheckIn";
import { DoStuff } from "./components/DoStuff";
import { Login } from "./components/Login";
import { Modal } from "./components/Controls";
function CheckInApp({
  userId,
  email,
  onExit,
  preview,
  cached,
}: {
  userId: string;
  email: string;
  onExit: () => void;
  preview: boolean;
  cached?: boolean;
}) {
  const [today, setToday] = useState(() => logicalDate()),
    [date, setDate] = useState(() => logicalDate()),
    [state, setState] = useState<SyncState>("local"),
    [syncError, setSyncError] = useState(""),
    [saveError, setSaveError] = useState(""),
    [saveCount, setSaveCount] = useState(0),
    [settings, setSettings] = useState(false);
  const [screen, setScreen] = useState<"today" | "tasks">("today");
  const saving = saveCount > 0;
  const engine = useRef<SyncEngine | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const pending =
    useLiveQuery(
      () => db.outbox.where("userId").equals(userId).count(),
      [userId],
    ) ?? 0;
  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (preview) return;
    const next = new SyncEngine(userId);
    engine.current = next;
    next.onState = () => {
      setState(next.state);
      setSyncError(next.error);
    };
    next.start();
    return () => {
      next.stop();
      engine.current = null;
    };
  }, [userId, preview]);
  useEffect(() => {
    const check = () => {
      const current = logicalDate();
      setToday(current);
      setDate((old) => (old > current ? current : old));
    };
    const id = setInterval(check, 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const switchScreen = (next: "today" | "tasks") => {
    if (repository.hasUnsaved(userId)) {
      setSaveError(
        "An edit is still unsaved. Retry saving before changing screens.",
      );
      return;
    }
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const navigate = (target: string) => {
    if (repository.hasUnsaved(userId)) {
      setSaveError(
        "An edit is still unsaved. Retry saving before changing days.",
      );
      return;
    }
    if (canNavigate(target, today)) {
      setDate(target);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const startTouch = (e: TouchEvent) => {
    if (screen !== "today") return;
    if (
      (e.target as Element).closest(
        'input,textarea,button,label,[role="button"],dialog',
      )
    ) {
      touch.current = null;
      return;
    }
    touch.current = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
    };
  };
  const endTouch = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x,
      dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5)
      navigate(addDays(date, dx < 0 ? 1 : -1));
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saving || repository.hasUnsaved(userId)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, userId]);
  const current = date === today;
  const status = saveError
    ? "Could not save"
    : saving
      ? "Saving…"
      : preview
        ? "Saved on this device"
        : state === "auth" || (cached && state === "local")
          ? "Sign in to sync"
          : state === "syncing"
            ? "Syncing…"
            : state === "offline"
              ? "Saved locally · offline"
              : state === "error"
                ? "Saved locally · sync paused"
                : pending
                  ? "Saved locally"
                  : state === "synced"
                    ? "All changes synced"
                    : "Saved locally";
  return (
    <div className="app-shell" onTouchStart={startTouch} onTouchEnd={endTouch}>
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          aria-label="180 home"
          onClick={(e) => {
            e.preventDefault();
            if (!repository.hasUnsaved(userId)) {
              setScreen("today");
              navigate(today);
            }
          }}
        >
          180<span>ONE DAY AT A TIME</span>
        </a>
        <div className="topbar-right">
          <span
            className={`save-state ${saveError ? "error" : ""}`}
            role="status"
          >
            {state === "offline" ? (
              <CloudOff size={13} />
            ) : saving || state === "syncing" ? (
              <RefreshCw size={13} className="spin" />
            ) : (
              <Check size={13} />
            )}
            <span>{status}</span>
          </span>
          <button
            className="icon-button account-button"
            aria-label="Account and app information"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <main>
        {preview && (
          <div className="preview-banner">
            <span>
              LOCAL PREVIEW{" "}
              <span className="preview-detail">
                · Entries stay on this device.
              </span>
            </span>
            <button className="text-button" onClick={onExit}>
              Sign in <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {(saveError || syncError) && (
          <div className="error-banner" role="alert">
            <span>
              {saveError
                ? `${saveError} This change has not been saved. Keep this page open and retry.`
                : syncError}
            </span>
            <button
              className="text-button"
              onClick={() =>
                saveError
                  ? void repository
                      .retryUnsaved(userId)
                      .then(() => setSaveError(""))
                      .catch((e) => setSaveError(e.message))
                  : engine.current?.schedule(0)
              }
            >
              {saveError ? "Retry saving" : "Retry sync"}
            </button>
          </div>
        )}
        {state === "auth" && !preview && (
          <div className="error-banner">
            <span>
              Your entries are saved locally. Sign in again to resume cloud
              sync.
            </span>
            <button className="text-button" onClick={onExit}>
              Sign in
            </button>
          </div>
        )}
        <nav className="screen-nav" aria-label="Main navigation">
          <button
            aria-label="Show daily check-in"
            aria-pressed={screen === "today"}
            onClick={() => switchScreen("today")}
          >
            Today
          </button>
          <button
            aria-pressed={screen === "tasks"}
            onClick={() => switchScreen("tasks")}
          >
            Do Stuff
          </button>
        </nav>
        {screen === "tasks" && (
          <DoStuff
            userId={userId}
            blocked={!!saveError}
            onSaving={(delta) =>
              setSaveCount((count) => Math.max(0, count + delta))
            }
            onError={setSaveError}
          />
        )}
        <div hidden={screen !== "today"}>
          {today < START_DATE ? (
            <section className="before-start">
              <span className="eyebrow">A NEW CHAPTER</span>
              <h1>Your Day 1 begins October 9.</h1>
              <p>The first check-in opens at 2 AM in your local timezone.</p>
            </section>
          ) : (
            <>
              <section className={`day-header ${current ? "is-today" : ""}`}>
                <div className="day-title">
                  <div className="day-badge">
                    {current ? (
                      <>
                        <span className="today-dot" />
                        TODAY
                      </>
                    ) : (
                      "PAST ENTRY"
                    )}
                  </div>
                  <h1>
                    Day {dayNumber(date)}
                    <span className="day-title-dot">.</span>
                  </h1>
                  <p>{dateLabel(date)}</p>
                </div>
                <div className="day-nav">
                  <button
                    className="icon-button"
                    aria-label="Previous day"
                    disabled={!canNavigate(addDays(date, -1), today)}
                    onClick={() => navigate(addDays(date, -1))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className="today-button"
                    onClick={() => navigate(today)}
                    disabled={current}
                  >
                    Today
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next day"
                    disabled={current}
                    onClick={() => navigate(addDays(date, 1))}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div className="day-decoration" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </section>
              {!current && date === addDays(today, -1) && (
                <div className="yesterday-note">
                  Yesterday’s entry is still freely editable.
                </div>
              )}
              <DailyCheckIn
                key={`${userId}-${date}`}
                userId={userId}
                date={date}
                today={today}
                preview={preview}
                onSaving={(delta) =>
                  setSaveCount((count) => Math.max(0, count + delta))
                }
                onError={setSaveError}
              />
            </>
          )}
        </div>
        <footer className="page-footer">
          <span>Just a record. Not a score.</span>
          <span>A new day starts at 2 AM.</span>
        </footer>
      </main>
      {updateReady && (
        <div className="update-banner" role="status">
          <span>A new version is ready.</span>
          <button
            className="text-button"
            disabled={saving || !!saveError}
            onClick={() => void updateServiceWorker(true)}
          >
            Update when ready <ArrowRight size={14} />
          </button>
        </div>
      )}
      {settings && (
        <Modal title="Your space" onClose={() => setSettings(false)}>
          <p>
            {preview
              ? "You’re using the local preview. Your preview entries are separate from your private account."
              : email}
          </p>
          <div className="settings-info">
            <p>
              <WifiOff size={15} />
              Local entries work offline after your first sign-in.
            </p>
            <p>
              Day 1: October 9, 2026
              <br />
              Day boundary: 2 AM · device local time
              <br />
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
            <p>On iPhone, open in Safari, then Share → Add to Home Screen.</p>
            {pending > 0 && !preview && (
              <p>
                {pending} change{pending === 1 ? "" : "s"} waiting to sync.
                They’ll stay on this device if you sign out.
              </p>
            )}
          </div>
          <button className="primary" onClick={onExit}>
            <LogOut size={16} />
            {preview ? "Back to sign in" : "Sign out"}
          </button>
        </Modal>
      )}
    </div>
  );
}
export default function App() {
  const auth = useAuth();
  const [preview, setPreview] = useState(
    () => sessionStorage.getItem("180-preview") === "true",
  );
  if (auth.loading && !preview)
    return (
      <div className="loading">
        <span className="wordmark">180</span>
        <p>Opening your day…</p>
      </div>
    );
  if (auth.recovery || (!auth.user && !preview))
    return (
      <Login
        onPreview={() => {
          sessionStorage.setItem("180-preview", "true");
          setPreview(true);
          auth.setRecovery(false);
        }}
        recovery={auth.recovery}
        onRecovered={() => auth.setRecovery(false)}
        initialError={auth.error}
      />
    );
  return (
    <CheckInApp
      key={preview ? "preview" : auth.user!.id}
      userId={preview ? "local-preview" : auth.user!.id}
      email={auth.user?.email ?? ""}
      preview={preview}
      cached={auth.user?.cached}
      onExit={() => {
        if (preview) {
          sessionStorage.removeItem("180-preview");
          setPreview(false);
        } else void auth.signOut();
      }}
    />
  );
}
