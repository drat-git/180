import { useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { repository } from "../lib/repository";
import {
  configurationFor,
  diffConfiguration,
  dayAnswers,
} from "../lib/customizationStore";
import {
  applyConfigurationPatch,
  listActivityRelevant,
  itemAnswerKey,
} from "../lib/customization";
import { modeForUser } from "../lib/appMode";
import { emptyData } from "../lib/model";
import type {
  Configuration,
  ConfigurationPatch,
} from "../lib/customizationTypes";
import { CustomizationEditor, ManageTodoLists } from "./CustomizationEditor";
import { Modal } from "./Controls";

const hasChanges = (patch: ConfigurationPatch) =>
  Object.values(patch).some((entities) => entities?.length);
const checklistPart = ({
  blocks,
  items,
}: ConfigurationPatch): ConfigurationPatch => ({
  ...(blocks?.length ? { blocks } : {}),
  ...(items?.length ? { items } : {}),
});

/** Publishing one connection must not discard unrelated fields in a retained draft. */
function withoutPublishedFields(
  draft: ConfigurationPatch,
  published: ConfigurationPatch,
): ConfigurationPatch {
  const result: ConfigurationPatch = {};
  for (const bucket of ["blocks", "items", "lists"] as const) {
    const remaining = (draft[bucket] ?? []).flatMap((entity) => {
      const applied = published[bucket]?.find(
        (value) => value.id === entity.id,
      );
      if (!applied) return [entity];
      const fields = Object.fromEntries(
        Object.entries(entity).filter(
          ([key]) => key === "id" || !(key in applied),
        ),
      );
      return Object.keys(fields).length > 1 ? [fields] : [];
    });
    if (remaining.length) Object.assign(result, { [bucket]: remaining });
  }
  return result;
}

export function CustomizationSettings({
  userId,
  today,
  kind,
  onClose,
}: {
  userId: string;
  today: string;
  kind: "checklist" | "lists";
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [reviewed, setReviewed] = useState(false);
  const [view, setView] = useState(kind);
  const state = useLiveQuery(async () => {
    const current = await configurationFor(userId, today);
    const [entry, records, draft, conflict, tasks, events] = await Promise.all([
      db.entries.get([userId, today]),
      db.customAnswers
        .where("[userId+logicalDate]")
        .equals([userId, today])
        .toArray(),
      db.meta.get(`customization-draft:${userId}`),
      db.meta.get(`customization-conflict:${userId}`),
      db.tasks.where("userId").equals(userId).toArray(),
      db.taskEvents.where("userId").equals(userId).toArray(),
    ]);
    let initialDraft = current.configuration;
    let conflictPatch: ConfigurationPatch = {};
    if (conflict) {
      try {
        conflictPatch = JSON.parse(conflict.value).patch ?? {};
        if (reviewed)
          initialDraft = applyConfigurationPatch(initialDraft, conflictPatch);
      } catch {
        /* An invalid retained payload never replaces the current definitions. */
      }
    }
    if (draft) {
      try {
        initialDraft = applyConfigurationPatch(
          initialDraft,
          JSON.parse(draft.value).patch,
        );
      } catch {
        /* Keep the last valid configuration available. */
      }
    }
    const retainedPatch = diffConfiguration(
      current.configuration,
      initialDraft,
    );
    const answers = dayAnswers(
      current.configuration,
      entry?.data ?? emptyData(),
      records,
    );
    const relevance = Object.fromEntries(
      current.configuration.lists.map((list) => {
        const item = current.configuration.items.find(
          (candidate) => candidate.listId === list.id,
        );
        return [
          list.id,
          listActivityRelevant(
            list.id,
            item
              ? answers[itemAnswerKey(item)]
              : { generation: 1, value: null, fields: {}, selections: [] },
            today,
            today,
            tasks,
            events,
            true,
            modeForUser(userId),
          ),
        ];
      }),
    );
    return {
      ...current,
      attempt,
      reviewed,
      answers,
      relevance,
      initialDraft,
      retainedPatch,
      conflictPatch,
      conflict: !!conflict,
    };
  }, [userId, today, attempt, reviewed]);
  // An open editor keeps its original revision until the user explicitly reviews again.
  const [base, setBase] = useState<typeof state>(undefined);
  if (
    state &&
    !base &&
    state.attempt === attempt &&
    state.reviewed === reviewed
  )
    setBase(state);
  const persist = useCallback(
    (draft: Configuration) => {
      if (!base) return;
      void db.meta.put({
        key: `customization-draft:${userId}`,
        value: JSON.stringify({
          patch: diffConfiguration(base.configuration, draft),
        }),
      });
    },
    [base, userId],
  );
  async function retainDraft(patch: ConfigurationPatch) {
    if (hasChanges(patch))
      await db.meta.put({
        key: `customization-draft:${userId}`,
        value: JSON.stringify({ patch }),
      });
    else await db.meta.delete(`customization-draft:${userId}`);
  }
  if (!base)
    return (
      <Modal title="Customize your space" onClose={onClose}>
        <p role="status">Loading your checklist…</p>
      </Modal>
    );

  async function publish(
    patch: ConfigurationPatch,
    date: string,
    revision: number,
  ) {
    if (!base) return;
    if (base.conflict && !reviewed)
      throw new Error(
        "Review the saved draft against the latest checklist before publishing.",
      );
    const latest = await configurationFor(userId, today);
    if (latest.revision !== revision)
      throw new Error(
        "Your checklist changed while this editor was open. Close and reopen to review your retained draft.",
      );
    if (base.conflict && reviewed)
      await repository.rebaseConfigurationConflict(userId);
    await repository.saveConfiguration(userId, patch, date, revision);
  }

  async function save(
    configuration: Configuration,
    date: string,
    revision: number,
    preserveUnrelatedDraft = false,
  ) {
    if (!base) return;
    const patch = diffConfiguration(base.configuration, configuration);
    const daily = checklistPart(patch);
    if (date !== today && patch.lists?.length && hasChanges(daily)) {
      // Lists are immediate; keep the daily remainder recoverable until its dated save succeeds.
      await retainDraft(patch);
      await publish({ lists: patch.lists }, today, revision);
      await retainDraft(daily);
      await db.meta.delete(`customization-conflict:${userId}`);
      const latest = await configurationFor(userId, today);
      try {
        await repository.saveConfiguration(
          userId,
          daily,
          date,
          latest.revision,
        );
      } catch (error) {
        throw new Error(
          `Your To-do list changes were saved. Your checklist draft is retained; reopen it to finish scheduling these changes. ${error instanceof Error ? error.message : ""}`,
        );
      }
    } else
      await publish(
        patch,
        patch.lists?.length && !hasChanges(daily) ? today : date,
        revision,
      );
    await retainDraft(
      preserveUnrelatedDraft
        ? withoutPublishedFields(base.retainedPatch, patch)
        : {},
    );
    await db.meta.delete(`customization-conflict:${userId}`);
    onClose();
  }

  async function saveLists(lists: Configuration["lists"], revision: number) {
    if (!base) return;
    const patch = diffConfiguration(base.configuration, {
      ...base.configuration,
      lists,
    });
    await publish(patch, today, revision);
    await retainDraft(checklistPart(base.retainedPatch));
    await db.meta.delete(`customization-conflict:${userId}`);
    setReviewed(false);
    setBase(undefined);
    setAttempt((value) => value + 1);
  }

  if (base.conflict && !reviewed)
    return (
      <Modal title="Review checklist changes" onClose={onClose}>
        <p>
          Your checklist changed on another device. Your draft is retained.
          Review it against the latest version before saving.
        </p>
        <button
          className="primary"
          onClick={() => {
            setReviewed(true);
            setBase(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          Review retained draft
        </button>
      </Modal>
    );

  const retainedChecklist = hasChanges(checklistPart(base.retainedPatch));
  const mixedConflict =
    base.conflict &&
    !!base.conflictPatch.lists?.length &&
    hasChanges(checklistPart(base.conflictPatch));
  const reviewLists =
    !mixedConflict &&
    (!!base.retainedPatch.lists?.length ||
      (base.conflict &&
        reviewed &&
        (!!base.conflictPatch.lists?.length || !retainedChecklist)));
  const showChecklist =
    mixedConflict ||
    (!reviewLists &&
      (view === "checklist" || (base.conflict && retainedChecklist)));
  const retainedListIds = new Set(
    [
      ...(base.retainedPatch.lists ?? []),
      ...(mixedConflict ? (base.conflictPatch.lists ?? []) : []),
    ].map((list) => list.id),
  );
  return showChecklist ? (
    <CustomizationEditor
      configuration={base.configuration}
      initialDraft={base.initialDraft}
      today={today}
      baseRevision={base.revision}
      answers={base.answers}
      relevance={base.relevance}
      retainedListChanges={base.initialDraft.lists.filter((list) =>
        retainedListIds.has(list.id),
      )}
      onDraftChange={persist}
      onSave={save}
      onClose={onClose}
    />
  ) : (
    <ManageTodoLists
      key={base.revision}
      configuration={base.configuration}
      initialLists={reviewLists ? base.initialDraft.lists : undefined}
      reviewRetainedLists={reviewLists}
      hasRetainedChecklistChanges={retainedChecklist}
      onReviewChecklist={() => setView("checklist")}
      today={today}
      baseRevision={base.revision}
      onSaveLists={saveLists}
      onSaveConnection={(configuration, date, revision) =>
        save(configuration, date, revision, true)
      }
      onClose={onClose}
    />
  );
}
