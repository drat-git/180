import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LockKeyhole } from "lucide-react";
import { db } from "../lib/db";
import { repository } from "../lib/repository";
import { emptyData, type EntryPatch } from "../lib/model";
import { needsUnlock, dayNumber, dateLabel } from "../lib/dates";
import { ChecklistBlock, Modal } from "./Controls";
import { TaskActivity } from "./TaskActivity";
import { useTasks } from "../lib/useTasks";
import { AntiRottingRecap } from "./AntiRotting";
import { Journal } from "./Journal";
import { DisplayPreferencesProvider } from "../lib/displayPreferences";
import { modeForUser } from "../lib/appMode";
import type { ChecklistProgress } from "../lib/checklist";
import type { ChecklistItem, ItemAnswer } from "../lib/customizationTypes";
import { useCustomization } from "../lib/useCustomization";
import {
  dayAnswers,
  answerPatch,
  taskQuestionRelevance,
  mergeAnswer,
} from "../lib/customizationStore";
import {
  customChecklistProgress,
  evaluateItem,
  itemAnswerKey,
  defaultConfiguration,
  resolveConfiguration,
  legacyItemAnswer,
} from "../lib/customization";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { CustomizationIcon } from "./CustomizationIcon";
import { PreviousAnswerView } from "./CustomizationEditor";

export function DailyCheckIn({
  userId,
  date,
  today,
  preview,
  onSaving,
  onError,
  renderHeader,
  onCustomize,
}: {
  userId: string;
  date: string;
  today: string;
  preview: boolean;
  onSaving: (delta: number) => void;
  onError: (v: string) => void;
  renderHeader?: (progress: ChecklistProgress) => ReactNode;
  onCustomize?: () => void;
}) {
  const mode = modeForUser(userId);
  const entry = useLiveQuery(
    () => db.entries.get([userId, date]),
    [userId, date],
  );
  const records = useLiveQuery(
    () =>
      db.customAnswers
        .where("[userId+logicalDate]")
        .equals([userId, date])
        .toArray(),
    [userId, date],
  );
  const { configuration, changes } = useCustomization(userId, date);
  const { tasks, roots, events } = useTasks(userId);
  const [data, setData] = useState(emptyData);
  const [optimistic, setOptimistic] = useState<
    Record<string, Partial<ItemAnswer>>
  >({});
  const dataRef = useRef(data);
  const pending = useRef(0);
  const pendingItems = useRef<Record<string, number>>({});
  const [answerAcknowledgement, setAnswerAcknowledgement] = useState(0);
  const [unlocked, setUnlocked] = useState(false),
    [confirm, setConfirm] = useState(false),
    [history, setHistory] = useState(false);
  const deferred = useRef<(() => void) | null>(null);
  const unlockedRef = useRef(false);
  const locked = needsUnlock(date, today) && !unlocked;
  useEffect(() => {
    if (entry && pending.current === 0) {
      const next = {
        ...emptyData(),
        ...entry.data,
        ...repository.unsavedFor(userId, date),
      };
      dataRef.current = next;
      setData(next);
    }
  }, [entry, date, userId]);
  useEffect(() => {
    setOptimistic({});
    setUnlocked(false);
    unlockedRef.current = false;
    setHistory(false);
  }, [date, userId]);
  useEffect(() => {
    setOptimistic((current) => {
      const next = { ...current };
      let changed = false;
      for (const [key, patch] of Object.entries(current)) {
        if (pendingItems.current[key]) continue;
        const record = records?.find(
          (record) => itemAnswerKey(record.itemId, record.generation) === key,
        );
        if (!record) continue;
        if (Object.hasOwn(patch, "value") && record.value.value !== patch.value)
          continue;
        if (
          patch.selections &&
          JSON.stringify(patch.selections) !==
            JSON.stringify(record.value.selections)
        )
          continue;
        if (
          Object.entries(patch.fields ?? {}).some(
            ([id, value]) =>
              JSON.stringify(value) !== JSON.stringify(record.value.fields[id]),
          )
        )
          continue;
        delete next[key];
        changed = true;
      }
      return changed ? next : current;
    });
  }, [records, answerAcknowledgement]);
  const storedAnswers = dayAnswers(configuration, data, records ?? []);
  const answers = Object.fromEntries(
    Object.entries(storedAnswers).map(([key, answer]) => [
      key,
      optimistic[key] ? mergeAnswer(answer, optimistic[key]) : answer,
    ]),
  );
  const relevance = Object.fromEntries(
    configuration.items.map((item) => [
      item.id,
      taskQuestionRelevance(
        item,
        answers[itemAnswerKey(item)],
        userId,
        date,
        today,
        tasks,
        events,
      ),
    ]),
  );
  const progress = customChecklistProgress(
    configuration,
    answers,
    date,
    relevance,
  );
  const namedProgress = {
    ...progress,
    blocks: Object.fromEntries(
      configuration.blocks.map((block) => [
        block.id === "food" ? "Food" : block.title,
        progress.blocks[block.id],
      ]),
    ),
  };
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
    if (locked && !unlockedRef.current) requestUnlock(apply);
    else apply();
  }
  function change(item: ChecklistItem, next: ItemAnswer) {
    const apply = () => {
      const key = itemAnswerKey(item),
        before = answers[key];
      const patch = answerPatch(before, next);
      pendingItems.current[key] = (pendingItems.current[key] ?? 0) + 1;
      setOptimistic((old) => ({
        ...old,
        [key]: {
          ...old[key],
          ...patch,
          fields: { ...old[key]?.fields, ...patch.fields },
        },
      }));
      mutate(async () => {
        try {
          await repository.patchItem(
            userId,
            date,
            item.id,
            item.generation,
            patch,
          );
        } finally {
          pendingItems.current[key]--;
          setAnswerAcknowledgement((value) => value + 1);
        }
      });
    };
    if (locked && !unlockedRef.current) requestUnlock(apply);
    else apply();
  }
  const previous = (records ?? []).filter((record) =>
    configuration.items.some(
      (item) =>
        item.id === record.itemId &&
        (item.generation !== record.generation ||
          item.deleted ||
          configuration.blocks.find((block) => block.id === item.blockId)
            ?.deleted),
    ),
  );
  for (const oldItem of defaultConfiguration(userId, date).items) {
    const current = configuration.items.find((item) => item.id === oldItem.id);
    if (
      !current ||
      (current.generation === oldItem.generation && !current.deleted)
    )
      continue;
    if (
      previous.some(
        (record) =>
          record.itemId === oldItem.id &&
          record.generation === oldItem.generation,
      )
    )
      continue;
    const value = legacyItemAnswer(oldItem, data);
    if (
      value.value !== null ||
      value.selections.length ||
      Object.values(value.fields).some(
        (field) => typeof field === "string" && field.trim(),
      )
    )
      previous.push({
        userId,
        logicalDate: date,
        itemId: oldItem.id,
        generation: oldItem.generation,
        value,
        revision: 0,
        createdAt: entry?.createdAt ?? "",
        updatedAt: entry?.updatedAt ?? "",
      });
  }
  const oldDefinition = (itemId: string, generation: number) => {
    let found = defaultConfiguration(userId, date).items.find(
      (item) => item.id === itemId && item.generation === generation,
    );
    for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
      const item = resolveConfiguration(
        userId,
        date,
        changes.filter((other) => other.sequence <= change.sequence),
      ).items.find(
        (item) => item.id === itemId && item.generation === generation,
      );
      if (item) found = item;
    }
    return found;
  };
  return (
    <>
      {renderHeader?.(namedProgress)}
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
              <h2>Daily checklist</h2>
            </div>
            {!configuration.items.some((item) => !item.deleted) && (
              <div className="onboarding-empty">
                <p>Your checklist is ready for your first check.</p>
                {onCustomize && (
                  <button className="text-button" onClick={onCustomize}>
                    Create your checklist
                  </button>
                )}
              </div>
            )}
            {configuration.blocks
              .filter(
                (block) =>
                  !block.deleted && progress.blocks[block.id]?.total > 0,
              )
              .sort((a, b) => a.order - b.order)
              .map((block) => (
                <ChecklistBlock
                  key={block.id}
                  title={block.title}
                  preferenceKey={
                    (
                      {
                        general: "General",
                        school: "School",
                        career: "Career",
                        food: "Food",
                        body: "Body",
                      } as Record<string, string>
                    )[block.id] ?? `custom:${block.id}`
                  }
                  icon={<CustomizationIcon name={block.icon} />}
                  progress={progress.blocks[block.id]}
                >
                  {configuration.items
                    .filter(
                      (item) =>
                        item.blockId === block.id &&
                        evaluateItem(item, answers[itemAnswerKey(item)], date, {
                          block,
                          relevant: relevance[item.id],
                        }).visible,
                    )
                    .sort((a, b) => a.order - b.order)
                    .map((item) => {
                      const answer = answers[itemAnswerKey(item)];
                      return (
                        <ChecklistItemInput
                          key={`${item.id}@${item.generation}`}
                          item={item}
                          answer={answer}
                          locked={locked}
                          onAttempt={(action) => requestUnlock(action)}
                          preferencePrefix={`${userId}:${item.id}:${item.generation}`}
                          onChange={(next) => change(item, next)}
                          taskContent={
                            item.kind === "tasks" ? (
                              <TaskActivity
                                topic={item.listId!}
                                label={item.label}
                                listTitle={
                                  configuration.lists.find(
                                    (list) => list.id === item.listId,
                                  )?.title
                                }
                                visible
                                roots={
                                  configuration.lists.find(
                                    (list) => list.id === item.listId,
                                  )?.deleted
                                    ? []
                                    : roots
                                }
                                tasks={tasks}
                                status={
                                  answer.value === true
                                    ? true
                                    : answer.value === false
                                      ? false
                                      : null
                                }
                                reason={String(answer.fields.reason ?? "")}
                                selections={answer.selections}
                                locked={locked}
                                onAttempt={() => requestUnlock()}
                                onAnswer={(value) =>
                                  change(item, { ...answer, value })
                                }
                                onReason={(value) =>
                                  change(item, {
                                    ...answer,
                                    fields: { ...answer.fields, reason: value },
                                  })
                                }
                                onSelections={(selections) =>
                                  change(item, { ...answer, selections })
                                }
                                hideAnswerAndReason
                              />
                            ) : undefined
                          }
                        />
                      );
                    })}
                </ChecklistBlock>
              ))}
            {previous.length > 0 && (
              <button className="text-button" onClick={() => setHistory(true)}>
                Previous answer versions
              </button>
            )}
            <AntiRottingRecap userId={userId} date={date} today={today} />
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
              You’re editing Day {dayNumber(date, mode.startDate)} from{" "}
              {dateLabel(date)}. Changes will modify your historical record.
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
                  unlockedRef.current = true;
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
        {history && (
          <Modal
            title="Previous answer versions"
            onClose={() => setHistory(false)}
          >
            <p>
              These answers are retained in their original format and are
              read-only.
            </p>
            {previous.map((record) => {
              const definition = oldDefinition(
                record.itemId,
                record.generation,
              );
              return (
                <div key={`${record.itemId}@${record.generation}`}>
                  <h3>
                    {definition?.label ?? "Previous item"} · version{" "}
                    {record.generation}
                  </h3>
                  {definition ? (
                    <PreviousAnswerView
                      item={definition}
                      answer={record.value}
                    />
                  ) : (
                    <p>{String(record.value.value ?? "Unanswered")}</p>
                  )}
                </div>
              );
            })}
          </Modal>
        )}
      </DisplayPreferencesProvider>
    </>
  );
}
