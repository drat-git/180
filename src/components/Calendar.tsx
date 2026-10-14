import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import { db } from "../lib/db";
import { type AppMode } from "../lib/appMode";
import { canNavigate, dateLabel, dayNumber } from "../lib/dates";
import {
  CALENDAR_BANDS,
  calendarDaySummary,
  monthDates,
  shiftMonth,
} from "../lib/calendar";
import "./Calendar.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function Calendar({
  userId,
  today,
  mode,
  onOpenDay,
}: {
  userId: string;
  today: string;
  mode: AppMode;
  onOpenDay: (date: string) => void;
}) {
  const [viewedMonth, setMonth] = useState(() => today.slice(0, 7));
  const [selectedDate, setSelected] = useState(today);
  // Retain history at rollover; moving the local clock backward must not leave
  // the calendar on an inaccessible future date or month.
  const month =
    viewedMonth > today.slice(0, 7) ? today.slice(0, 7) : viewedMonth;
  const selected = selectedDate > today ? today : selectedDate;
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      const snapshot = await db.transaction(
        "r",
        [
          db.entries,
          db.tasks,
          db.taskEvents,
          db.images,
          db.antiLogs,
          db.antiEvents,
        ],
        async () => {
          const [entries, tasks, events, images, antiLogs, antiEvents] =
            await Promise.all([
              db.entries.where("userId").equals(userId).toArray(),
              db.tasks.where("userId").equals(userId).toArray(),
              db.taskEvents.where("userId").equals(userId).toArray(),
              db.images.where("userId").equals(userId).toArray(),
              db.antiLogs.where("userId").equals(userId).toArray(),
              db.antiEvents.where("userId").equals(userId).toArray(),
            ]);
          return { entries, tasks, events, images, antiLogs, antiEvents };
        },
      );
      return { snapshot, error: "" };
    } catch {
      return { snapshot: null, error: "Could not load your calendar." };
    }
  }, [userId, attempt]);
  const dates = useMemo(() => monthDates(month), [month]);
  const summaries = useMemo(() => {
    const snapshot = result?.snapshot;
    if (!snapshot) return null;
    return new Map(
      dates
        .filter((date) => canNavigate(date, today, mode.startDate))
        .map((date) => [
          date,
          calendarDaySummary(snapshot, userId, date, today, mode),
        ]),
    );
  }, [result, dates, userId, today, mode]);
  const summary = summaries?.get(selected);
  const workedOn = summary
    ? [
        ...Object.values(summary.workedOn)
          .flat()
          .map((task) => ({
            ...task,
            key: `task:${task.taskId}`,
          })),
        ...summary.antiRotting.map((activity) => ({
          key: `anti:${activity.itemId}`,
          title: activity.title,
          workedOn: true,
          children: [],
        })),
      ].sort(
        (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
      )
    : [];
  const firstMonth = mode.startDate.slice(0, 7);
  const lastMonth = today.slice(0, 7);
  function moveMonth(delta: number) {
    const next = shiftMonth(month, delta);
    if (next < firstMonth || next > lastMonth) return;
    setMonth(next);
    setSelected(next === firstMonth ? mode.startDate : `${next}-01`);
  }
  function selectDay(date: string) {
    if (!canNavigate(date, today, mode.startDate)) return;
    setMonth(date.slice(0, 7));
    setSelected(date);
  }
  return (
    <section className="history-calendar" aria-label="Interactive calendar">
      <div className="calendar-month">
        <header className="calendar-heading">
          <div>
            <p className="calendar-eyebrow">YOUR DAYS</p>
            <h1>{monthLabel(month)}</h1>
          </div>
          <div className="calendar-navigation">
            <button
              type="button"
              aria-label="Previous month"
              disabled={month <= firstMonth}
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => selectDay(today)}>
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              disabled={month >= lastMonth}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        {!result ? (
          <p role="status" className="calendar-message">
            Loading your days…
          </p>
        ) : result.error ? (
          <div className="calendar-message">
            <p role="alert">{result.error}</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry loading calendar
            </button>
          </div>
        ) : (
          <>
            <div className="calendar-grid" aria-label={monthLabel(month)}>
              {weekdays.map((day) => (
                <span key={day} className="calendar-weekday" aria-hidden="true">
                  {day}
                </span>
              ))}
              {dates.map((date) => {
                const day = summaries?.get(date);
                const enabled = canNavigate(date, today, mode.startDate);
                const description = day?.recorded
                  ? `${day.completed} of ${day.total} checks complete, ${day.percentage}%`
                  : "No entries recorded";
                return (
                  <button
                    type="button"
                    key={date}
                    className="calendar-date"
                    data-outside={date.slice(0, 7) !== month || undefined}
                    data-selected={selected === date || undefined}
                    aria-label={`${dateLabel(date)}, ${date.slice(0, 4)}${date === today ? ", Today" : ""}, ${enabled ? description : "Unavailable"}`}
                    aria-current={date === today ? "date" : undefined}
                    aria-pressed={selected === date}
                    disabled={!enabled}
                    onClick={() => selectDay(date)}
                  >
                    <span
                      className="calendar-bubble"
                      data-band={day?.band ?? undefined}
                    >
                      {Number(date.slice(-2))}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="calendar-legend"
              aria-label="Checklist completion color legend"
            >
              {CALENDAR_BANDS.map((label, band) => (
                <span key={label}>
                  <i data-band={band} aria-hidden="true" />
                  {label}
                </span>
              ))}
              <span>
                <i className="calendar-empty-swatch" aria-hidden="true" />
                No entries
              </span>
            </div>
          </>
        )}
      </div>
      {summary && !result?.error && (
        <section className="calendar-preview" aria-label="Day preview">
          <div className="calendar-preview-heading">
            <div aria-live="polite" aria-atomic="true">
              <p className="calendar-eyebrow">
                DAY {dayNumber(selected, mode.startDate)}
                {selected === today ? " · IN PROGRESS" : " · DAILY RECORD"}
              </p>
              <h2>{dateLabel(selected)}</h2>
              <p
                className="calendar-total"
                aria-label="Calendar checklist progress"
              >
                <strong>
                  {summary.completed} of {summary.total}
                </strong>{" "}
                checks complete
              </p>
              {!summary.recorded && (
                <p className="calendar-empty">No entries recorded</p>
              )}
            </div>
            <button
              type="button"
              className="calendar-open"
              onClick={() => onOpenDay(selected)}
            >
              Open day <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </div>
          <dl
            className="calendar-blocks"
            aria-label="Checklist category progress"
          >
            {Object.entries(summary.blocks)
              .filter(([, count]) => count.total > 0)
              .map(([block, count]) => (
                <div key={block}>
                  <dt>{block === "Food" ? "Diet" : block}</dt>
                  <dd>
                    {count.completed}/{count.total}
                  </dd>
                </div>
              ))}
          </dl>
          <h3>Things you did</h3>
          {workedOn.length === 0 ? (
            <p className="calendar-empty">No activities recorded</p>
          ) : (
            <ul className="calendar-work" aria-label="Activities worked on">
              {workedOn.map((task) => (
                <li key={task.key}>
                  <span>
                    {task.workedOn || task.title === "Subtasks"
                      ? task.title
                      : `Subtasks of ${task.title}`}
                  </span>
                  {task.children.length > 0 && (
                    <ul>
                      {task.children.map((child) => (
                        <li key={child.taskId}>{child.title}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
