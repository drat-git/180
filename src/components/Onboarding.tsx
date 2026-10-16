import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { db } from "../lib/db";
import { completeOnboarding, onboardingDraftKey } from "../lib/accounts";
import type { AccountProfile } from "../lib/accountProfile";
import {
  starterTemplates,
  starterSelection,
  selectStarterList,
  type OnboardingSelection,
} from "../lib/starters";
import { summarizeItem, summarizeSchedule } from "../lib/editorPresentation";
import { CustomizationIcon } from "./CustomizationIcon";
import "./Onboarding.css";

export function Onboarding({
  userId,
  onComplete,
  onSignOut,
}: {
  userId: string;
  onComplete: (profile: AccountProfile) => void;
  onSignOut: () => void;
}) {
  const [selection, setSelection] = useState<OnboardingSelection>();
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const heading = useRef<HTMLHeadingElement>(null);
  const template = starterTemplates.find(
    (entry) => entry.id === selection?.starterId,
  );
  useEffect(() => {
    let active = true;
    void db.meta
      .get(onboardingDraftKey(userId))
      .then((row) => {
        if (!active) return;
        try {
          const draft = row ? JSON.parse(row.value) : null;
          const candidate = draft?.selection;
          const starter = starterTemplates.find(
            (entry) =>
              entry.id === candidate?.starterId &&
              entry.version === candidate?.version,
          );
          if (
            starter &&
            typeof candidate.operationId === "string" &&
            ["items", "lists", "tasks", "activities"].every(
              (key) =>
                Array.isArray(candidate[key]) &&
                candidate[key].every((id: unknown) => typeof id === "string"),
            )
          ) {
            setSelection(candidate);
            setStep(draft.step === "review" ? "review" : "choose");
          }
        } catch {
          /* A stale draft leaves the starter picker available. */
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setError("Your setup draft could not be loaded on this device.");
        }
      });
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      active = false;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [userId]);
  useEffect(() => {
    if (ready && selection)
      void db.meta
        .put({
          key: onboardingDraftKey(userId),
          value: JSON.stringify({ step, selection }),
        })
        .catch(() =>
          setError(
            "Your setup draft could not be saved. Keep this page open and try again.",
          ),
        );
  }, [userId, selection, step, ready]);
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step, ready]);
  const toggle = (
    key: "items" | "tasks" | "activities",
    id: string,
    enabled: boolean,
  ) =>
    setSelection((current) =>
      current
        ? {
            ...current,
            [key]: enabled
              ? [...new Set([...current[key], id])]
              : current[key].filter((value) => value !== id),
          }
        : current,
    );
  async function finish() {
    if (!selection || !online || busy) return;
    setBusy(true);
    setError("");
    try {
      await db.meta.put({
        key: onboardingDraftKey(userId),
        value: JSON.stringify({ step, selection }),
      });
      const profile = await completeOnboarding(userId, selection);
      onComplete(profile);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your setup could not be confirmed. Your choices are saved; please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <span className="wordmark">
          180<span>ONE DAY AT A TIME</span>
        </span>
        <button className="text-button" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </header>
      <div className="onboarding-content">
        <span className="eyebrow">
          YOUR SPACE · {step === "choose" ? "1 OF 2" : "2 OF 2"}
        </span>
        <h1 ref={heading} tabIndex={-1}>
          {step === "choose" ? "Find your starting point." : "Make it yours."}
        </h1>
        <p className="onboarding-intro">
          {step === "choose"
            ? "Start with a few useful suggestions, or build your own. You can change everything later."
            : "Keep what fits. Uncheck anything you don’t want—you can edit or add more in Your space afterward."}
        </p>
        {!ready ? (
          <p role="status">Loading your choices…</p>
        ) : step === "choose" ? (
          <div className="onboarding-starters">
            {starterTemplates.map((entry) => (
              <button
                type="button"
                className={`onboarding-starter${selection?.starterId === entry.id ? " selected" : ""}`}
                key={entry.id}
                onClick={() => {
                  if (selection?.starterId !== entry.id)
                    setSelection(starterSelection(entry));
                  setStep("review");
                  setError("");
                }}
              >
                <strong>{entry.title}</strong>
                <span>{entry.description}</span>
                <small>
                  {entry.id === "blank"
                    ? "Your own checks, lists and activities"
                    : "6 checks · 2 lists · 6 Anti-rot ideas"}
                </small>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          template &&
          selection && (
            <>
              <div className="onboarding-chosen">
                <Check size={17} />
                <strong>{template.title}</strong>
              </div>
              {template.id === "blank" ? (
                <div className="onboarding-empty">
                  <h2>A clean slate.</h2>
                  <p>
                    You’ll start with no checks, To-do lists or Anti-rot
                    activities. Creation tools are in Your space.
                  </p>
                </div>
              ) : (
                <>
                  <section
                    aria-label="Starter daily checklist"
                    className="onboarding-section"
                  >
                    <h2>Daily checklist</h2>
                    {template.configuration.blocks.map((block) => (
                      <fieldset key={block.id}>
                        <legend>
                          <CustomizationIcon name={block.icon} />
                          {block.title}
                        </legend>
                        {template.configuration.items
                          .filter((item) => item.blockId === block.id)
                          .map((item) => (
                            <label className="onboarding-option" key={item.id}>
                              <input
                                type="checkbox"
                                disabled={
                                  busy ||
                                  (!!item.listId &&
                                    !selection.lists.includes(item.listId))
                                }
                                checked={selection.items.includes(item.id)}
                                onChange={(event) =>
                                  toggle("items", item.id, event.target.checked)
                                }
                              />
                              <span>
                                <strong>{item.label}</strong>
                                <small>
                                  {summarizeItem(item)}
                                  {item.schedule
                                    ? ` · ${summarizeSchedule(item.schedule)}`
                                    : ""}
                                </small>
                              </span>
                            </label>
                          ))}
                      </fieldset>
                    ))}
                  </section>
                  <section
                    aria-label="Starter To-do lists and tasks"
                    className="onboarding-section"
                  >
                    <h2>To-do lists and tasks</h2>
                    {template.configuration.lists.map((list) => (
                      <fieldset key={list.id}>
                        <legend>
                          <CustomizationIcon name={list.icon} />
                          {list.title}
                        </legend>
                        <label className="onboarding-option">
                          <input
                            type="checkbox"
                            checked={selection.lists.includes(list.id)}
                            disabled={busy}
                            onChange={(event) =>
                              setSelection(
                                selectStarterList(
                                  template,
                                  selection,
                                  list.id,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>
                            <strong>Keep {list.title} list</strong>
                          </span>
                        </label>
                        {!selection.lists.includes(list.id) && (
                          <p className="onboarding-dependency">
                            Its daily question and starter tasks are deselected
                            too. Select the list again to choose which ones to
                            add.
                          </p>
                        )}
                        {template.tasks
                          .filter((task) => task.listId === list.id)
                          .map((task) => (
                            <label
                              className="onboarding-option onboarding-task"
                              key={task.id}
                            >
                              <input
                                type="checkbox"
                                disabled={
                                  busy || !selection.lists.includes(list.id)
                                }
                                checked={selection.tasks.includes(task.id)}
                                onChange={(event) =>
                                  toggle("tasks", task.id, event.target.checked)
                                }
                              />
                              <span>{task.title}</span>
                            </label>
                          ))}
                      </fieldset>
                    ))}
                  </section>
                  <section
                    aria-label="Starter Anti-rot activities"
                    className="onboarding-section"
                  >
                    <h2>Anti-rot activities</h2>
                    {template.activities.map((activity) => (
                      <label className="onboarding-option" key={activity.id}>
                        <input
                          type="checkbox"
                          checked={selection.activities.includes(activity.id)}
                          disabled={busy}
                          onChange={(event) =>
                            toggle(
                              "activities",
                              activity.id,
                              event.target.checked,
                            )
                          }
                        />
                        <span>
                          <strong>{activity.title}</strong>
                          <small>
                            {activity.itemType === "one-time"
                              ? "One-time activity"
                              : "Reusable activity"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </section>
                </>
              )}
            </>
          )
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!online && (
          <p role="status" className="onboarding-dependency">
            You can review your choices offline. Connect to finish creating your
            space.
          </p>
        )}
        {step === "review" && (
          <footer className="onboarding-footer">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setStep("choose")}
            >
              <ArrowLeft size={16} />
              Back to starters
            </button>
            <button
              className="primary"
              disabled={busy || !online || !ready}
              onClick={() => void finish()}
            >
              {busy ? "Creating your space…" : "Start using 180"}
              <ArrowRight size={17} />
            </button>
          </footer>
        )}
      </div>
    </main>
  );
}
