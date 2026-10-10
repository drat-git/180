import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Activity,
  BriefcaseBusiness,
  Compass,
  GraduationCap,
  LockKeyhole,
  Sun,
  Utensils,
} from "lucide-react";
import { db } from "../lib/db";
import { repository } from "../lib/repository";
import {
  binaryFields,
  emptyData,
  reasonVisible,
  answerPatch,
  type EntryPatch,
  type ReasonKey,
  type BinaryKey,
  type ActivityTopic,
} from "../lib/model";
import { weekday, needsUnlock, dayNumber, dateLabel } from "../lib/dates";
import {
  BinaryAnswer,
  Counter,
  Reason,
  Modal,
  CollapsibleText,
  CannabisDescriptions,
  ChecklistBlock,
} from "./Controls";
import { TaskActivity } from "./TaskActivity";
import { useTasks } from "../lib/useTasks";
import { Journal } from "./Journal";
import { DisplayPreferencesProvider } from "../lib/displayPreferences";
import { checklistProgress, type ChecklistProgress } from "../lib/checklist";
export function DailyCheckIn({
  userId,
  date,
  today,
  preview,
  onSaving,
  onError,
  renderHeader,
}: {
  userId: string;
  date: string;
  today: string;
  preview: boolean;
  onSaving: (delta: number) => void;
  onError: (v: string) => void;
  renderHeader?: (progress: ChecklistProgress) => ReactNode;
}) {
  const entry = useLiveQuery(
    () => db.entries.get([userId, date]),
    [userId, date],
  );
  const [data, setData] = useState(emptyData);
  const dataRef = useRef(data);
  const pending = useRef(0);
  const [unlocked, setUnlocked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const deferred = useRef<(() => void) | null>(null);
  const locked = needsUnlock(date, today) && !unlocked;
  useEffect(() => {
    if (entry && pending.current === 0) {
      dataRef.current = {
        ...emptyData(),
        ...entry.data,
        ...repository.unsavedFor(userId, date),
      };
      setData(dataRef.current);
    }
  }, [entry]);
  function mutate(action: () => Promise<unknown>) {
    pending.current++;
    onSaving(1);
    void action()
      .catch((e) =>
        onError(e instanceof Error ? e.message : "Could not save locally."),
      )
      .finally(() => {
        pending.current--;
        onSaving(-1);
      });
  }
  function requestUnlock(action?: () => void) {
    deferred.current = action ?? null;
    setConfirm(true);
  }
  function patch(patch: EntryPatch) {
    const apply = () => {
      dataRef.current = { ...dataRef.current, ...patch };
      setData(dataRef.current);
      mutate(() => repository.patchDay(userId, date, patch));
    };
    if (locked) requestUnlock(apply);
    else apply();
  }
  function reason(key: ReasonKey, label: string) {
    return reasonVisible(key, data) ? (
      <Reason
        label={label}
        value={data[`${key}Reason`]}
        locked={locked}
        onAttempt={() => requestUnlock()}
        onChange={(value) => patch({ [`${key}Reason`]: value })}
      />
    ) : null;
  }
  const { tasks, roots } = useTasks(userId);
  const progress = checklistProgress(data, date, roots);
  function activity(topic: ActivityTopic) {
    const statusKey = `${topic}TasksStatus` as const;
    const reasonKey = `${topic}TasksReason` as const;
    const selectionKey = `${topic}TasksWorkedOn` as const;
    return (
      <TaskActivity
        topic={topic}
        roots={roots}
        tasks={tasks}
        status={data[statusKey]}
        reason={data[reasonKey]}
        selections={data[selectionKey]}
        locked={locked}
        onAttempt={() => requestUnlock()}
        onAnswer={(answer) =>
          patch({
            [statusKey]: dataRef.current[statusKey] === answer ? null : answer,
          })
        }
        onReason={(value) => patch({ [reasonKey]: value })}
        onSelections={(values) => patch({ [selectionKey]: values })}
      />
    );
  }
  const weekdayOnly = weekday(date) !== 0 && weekday(date) !== 6;
  function renderFields(keys: BinaryKey[]) {
    return binaryFields
      .filter(
        (f) => keys.includes(f.key) && (!("weekdays" in f) || weekdayOnly),
      )
      .map((field) => {
        const key = field.key;
        const countKey =
          key === "cannabis" ? "cannabisCount" : "applicationsCount";
        return (
          <div className="field" key={key}>
            <div className="field-line">
              <span className="field-label">{field.label}</span>
              <BinaryAnswer
                label={field.label}
                value={data[`${key}Status`]}
                onChange={(answer) =>
                  patch(
                    answerPatch(
                      key,
                      dataRef.current[`${key}Status`],
                      answer,
                      dataRef.current,
                    ),
                  )
                }
              />
            </div>
            {"description" in field && data[`${key}Status`] === true && (
              <CollapsibleText
                label="What did you eat?"
                ariaLabel={`${field.label} food description`}
                addLabel="What did you eat? Add description"
                viewLabel="View food description"
                initiallyExpanded
                placeholder="Just a quick description"
                value={data[`${field.key}Description`]}
                locked={locked}
                onAttempt={() => requestUnlock()}
                onChange={(value) => patch({ [`${key}Description`]: value })}
              />
            )}
            {"count" in field && data[`${key}Status`] === true && (
              <Counter
                label={
                  key === "cannabis"
                    ? "How many times?"
                    : "How many applications?"
                }
                value={data[countKey] ?? 1}
                onChange={(value) => patch({ [countKey]: value })}
              />
            )}
            {key === "cannabis" && data.cannabisStatus === true && (
              <CannabisDescriptions
                count={data.cannabisCount ?? 1}
                values={data.cannabisUseDescriptions}
                locked={locked}
                onAttempt={() => requestUnlock()}
                onChange={(index, value) => {
                  const descriptions = [
                    ...dataRef.current.cannabisUseDescriptions,
                  ];
                  while (descriptions.length <= index) descriptions.push("");
                  descriptions[index] = value;
                  patch({ cannabisUseDescriptions: descriptions });
                }}
              />
            )}
            {reason(key, field.label)}
          </div>
        );
      });
  }
  const wakeField = (
    <div className="field">
      <div className="field-line">
        <label htmlFor="wake">
          <Sun size={16} />
          <span>Wake-up time</span>
        </label>
        <input
          id="wake"
          type="time"
          value={data.wakeTime ?? ""}
          readOnly={locked}
          onFocus={() => {
            if (locked) requestUnlock();
          }}
          onChange={(e) => patch({ wakeTime: e.target.value || null })}
        />
      </div>
      {reason("wake", "Wake-up time")}
    </div>
  );
  const screenField = (
    <div className="field">
      <div className="field-line">
        <label htmlFor="screen-hours">Screen time</label>
        <div className="duration">
          <input
            id="screen-hours"
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            aria-label="Screen time hours"
            placeholder="—"
            value={
              data.screenTimeMinutes === null
                ? ""
                : Math.floor(data.screenTimeMinutes / 60)
            }
            readOnly={locked}
            onFocus={() => {
              if (locked) requestUnlock();
            }}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                patch({
                  screenTimeMinutes:
                    data.screenTimeMinutes !== null &&
                    data.screenTimeMinutes % 60
                      ? data.screenTimeMinutes % 60
                      : null,
                });
                return;
              }
              const h = Math.max(0, Math.min(24, Math.trunc(Number(raw))));
              patch({
                screenTimeMinutes: Math.min(
                  1440,
                  h * 60 + ((data.screenTimeMinutes ?? 0) % 60),
                ),
              });
            }}
          />
          <span>hrs</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            aria-label="Screen time minutes"
            placeholder="—"
            value={
              data.screenTimeMinutes === null ? "" : data.screenTimeMinutes % 60
            }
            readOnly={locked}
            onFocus={() => {
              if (locked) requestUnlock();
            }}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                patch({
                  screenTimeMinutes:
                    data.screenTimeMinutes !== null &&
                    Math.floor(data.screenTimeMinutes / 60)
                      ? Math.floor(data.screenTimeMinutes / 60) * 60
                      : null,
                });
                return;
              }
              const m = Math.max(0, Math.min(59, Math.trunc(Number(raw))));
              patch({
                screenTimeMinutes: Math.min(
                  1440,
                  Math.floor((data.screenTimeMinutes ?? 0) / 60) * 60 + m,
                ),
              });
            }}
          />
          <span>min</span>
          {data.screenTimeMinutes !== null && (
            <button
              className="text-button clear-time"
              aria-label="Clear screen time"
              onClick={() => patch({ screenTimeMinutes: null })}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {reason("screenTime", "Screen time")}
    </div>
  );
  return (
    <>
      {renderHeader?.(progress)}
      <DisplayPreferencesProvider userId={userId}>
        {locked ? (
          <div className="past-note">
            <LockKeyhole size={15} />
            <span>This past entry is protected.</span>
            <button className="text-button" onClick={() => requestUnlock()}>
              Edit entry
            </button>
          </div>
        ) : (
          unlocked && (
            <div className="past-note">
              <LockKeyhole size={15} />
              <span>Editing past day</span>
            </div>
          )
        )}
        <div className="checkin-layout">
          <section className="checkin-card">
            <div className="section-heading">
              <h2>Daily check-in</h2>
            </div>
            <ChecklistBlock
              title="General"
              icon={<Compass size={18} />}
              progress={progress.blocks.General}
            >
              {wakeField}
              {screenField}
              {renderFields(["cannabis"])}
            </ChecklistBlock>
            {progress.blocks.School.total > 0 && (
              <ChecklistBlock
                title="School"
                icon={<GraduationCap size={18} />}
                progress={progress.blocks.School}
              >
                {renderFields(["classAttendance"])}
                {activity("school")}
              </ChecklistBlock>
            )}
            <ChecklistBlock
              title="Career"
              icon={<BriefcaseBusiness size={18} />}
              progress={progress.blocks.Career}
            >
              {renderFields(["applications"])}
              {activity("career")}
            </ChecklistBlock>
            <ChecklistBlock
              title="Food"
              icon={<Utensils size={18} />}
              progress={progress.blocks.Food}
            >
              {renderFields(["meal1", "meal2", "snack1", "snack2", "shake"])}
            </ChecklistBlock>
            <ChecklistBlock
              title="Body"
              icon={<Activity size={18} />}
              progress={progress.blocks.Body}
            >
              {renderFields(["amPosture", "pmPosture", "lifted"])}
            </ChecklistBlock>
          </section>
          <Journal
            userId={userId}
            date={date}
            text={data.journalText}
            onText={(value) => patch({ journalText: value })}
            locked={locked}
            onAttempt={() => requestUnlock()}
            mutate={mutate}
            preview={preview}
          />
        </div>
        {confirm && (
          <Modal
            title="Edit past entry?"
            onClose={() => {
              setConfirm(false);
              deferred.current = null;
            }}
          >
            <p>
              You’re editing Day {dayNumber(date)} from {dateLabel(date)}.
              Changes will modify your historical record.
            </p>
            <div className="dialog-actions">
              <button
                onClick={() => {
                  setConfirm(false);
                  deferred.current = null;
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  setUnlocked(true);
                  setConfirm(false);
                  deferred.current?.();
                  deferred.current = null;
                }}
              >
                Edit Anyway
              </button>
            </div>
          </Modal>
        )}
      </DisplayPreferencesProvider>
    </>
  );
}
