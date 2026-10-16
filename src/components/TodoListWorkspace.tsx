import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import type {
  ChecklistItem,
  Configuration,
  ItemAnswer,
  TodoListDefinition,
} from "../lib/customizationTypes";
import {
  applyEditorFormChanges,
  resolveEditorFormConflicts,
  type EditorRecoveryForm,
  type EditorRecoveryState,
} from "../lib/editorRecovery";
import {
  defaultAnswer,
  evaluateItem,
  scheduleMatches,
  validateConfiguration,
} from "../lib/customization";
import {
  editorItem,
  normalizeEditorItem,
  normalizedOrders,
  reordered,
} from "../lib/editorPresentation";
import { addDays } from "../lib/dates";
import { createId } from "../lib/model";
import { CustomizationIcon } from "./CustomizationIcon";
import { ChecklistItemEditor } from "./ChecklistItemEditor";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { EditorWorkspace } from "./EditorWorkspace";
import { Field, IconSelect } from "./EditorFields";
import { ReorderHandle } from "./ReorderHandle";
import { Modal } from "./Controls";

export interface ManageTodoListsProps {
  configuration: Configuration;
  initialLists?: TodoListDefinition[];
  reviewRetainedLists?: boolean;
  hasRetainedChecklistChanges?: boolean;
  onReviewChecklist?: () => void;
  today: string;
  baseRevision: number;
  onSaveLists: (
    lists: TodoListDefinition[],
    baseRevision: number,
  ) => Promise<void> | void;
  onSaveConnection: (
    configuration: Configuration,
    effectiveDate: string,
    baseRevision: number,
  ) => Promise<void> | void;
  onClose: () => void;
  recovery?: EditorRecoveryState;
  onRecoveryChange?: (state: EditorRecoveryState | null) => void;
  draftError?: string;
}

type ListForm =
  | {
      kind: "list";
      before: TodoListDefinition | null;
      value: TodoListDefinition;
      isNew: boolean;
      conflicts?: string[];
    }
  | {
      kind: "connection";
      before: ChecklistItem | null;
      value: ChecklistItem;
      isNew: boolean;
      conflicts?: string[];
    };
const copy = <T,>(value: T): T => structuredClone(value);
const ordered = <T extends { order: number }>(values: T[]) =>
  [...values].sort((a, b) => a.order - b.order);
const isListForm = (form: EditorRecoveryForm): form is ListForm =>
  form.kind === "list" || form.kind === "connection";
const formKey = (form: ListForm) =>
  `${form.kind}:${form.kind === "list" ? form.value.id : form.value.listId}`;
const changed = (form: ListForm | null) =>
  !!form &&
  (form.isNew ||
    !!form.conflicts?.length ||
    JSON.stringify(form.before) !== JSON.stringify(form.value));

/** List edits publish immediately; a connected question remains a separately dated change. */
export function ManageTodoLists({
  configuration,
  initialLists,
  reviewRetainedLists = false,
  hasRetainedChecklistChanges = false,
  onReviewChecklist,
  today,
  baseRevision,
  onSaveLists,
  onSaveConnection,
  onClose,
  recovery,
  onRecoveryChange,
  draftError,
}: ManageTodoListsProps) {
  const restored = recovery?.section === "lists" ? recovery : undefined;
  const [lists, setLists] = useState(() =>
    copy(initialLists ?? configuration.lists),
  );
  const [form, setForm] = useState<ListForm | null>(() =>
    restored?.form && isListForm(restored.form) ? copy(restored.form) : null,
  );
  const [drafts, setDrafts] = useState<ListForm[]>(() =>
    copy(restored?.drafts?.filter(isListForm) ?? []),
  );
  const [review, setReview] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewDate, setPreviewDate] = useState(today);
  const [example, setExample] = useState<ItemAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const reorderSnapshot = useRef<TodoListDefinition[] | null>(null);
  const active = ordered(lists.filter((list) => !list.deleted));
  const archived = ordered(lists.filter((list) => list.deleted));
  const blocks = ordered(
    configuration.blocks.filter((block) => !block.deleted),
  );

  useEffect(() => {
    setLists(copy(initialLists ?? configuration.lists));
  }, [configuration.lists, initialLists]);
  const exampleSchema =
    form?.kind === "connection"
      ? JSON.stringify({
          id: form.value.id,
          kind: form.value.kind,
          options: form.value.options,
          fields: form.value.followups.map(({ id, kind, options }) => ({
            id,
            kind,
            options,
          })),
        })
      : "";
  useEffect(() => {
    setExample(null);
  }, [exampleSchema]);
  const unresolved = !!form?.conflicts?.length;
  const removed = !!form?.conflicts?.includes("__removed");
  function resolveConflict(keepLocal: boolean) {
    if (!form || removed) return;
    const next = resolveEditorFormConflicts(form, keepLocal);
    if (isListForm(next)) setForm(next);
    setError("");
  }

  const retain = useCallback(
    (nextForm: ListForm | null, nextDrafts: ListForm[]) => {
      onRecoveryChange?.(
        nextForm || nextDrafts.length
          ? {
              section: "lists",
              selectionId: nextForm
                ? nextForm.kind === "list"
                  ? nextForm.value.id
                  : nextForm.value.listId
                : undefined,
              level: nextForm ? "form" : "overview",
              ...(nextForm ? { form: nextForm } : {}),
              ...(nextDrafts.length ? { drafts: nextDrafts } : {}),
              baseRevision,
            }
          : null,
      );
    },
    [onRecoveryChange, baseRevision],
  );
  useEffect(() => {
    retain(form, drafts);
  }, [form, drafts, retain]);

  function requestNavigation(action: () => void) {
    if (busy) return;
    if (removed) {
      cancelForm();
      action();
      return;
    }
    if (changed(form)) {
      setPendingNavigation(() => action);
      return;
    }
    setForm(null);
    setReview(false);
    setPreview(false);
    retain(null, drafts);
    action();
  }
  function leaveForm(mode: "save" | "discard") {
    const nextDrafts = form
      ? [
          ...drafts.filter((value) => formKey(value) !== formKey(form)),
          ...(mode === "save" ? [copy(form)] : []),
        ]
      : drafts;
    setDrafts(nextDrafts);
    setForm(null);
    setReview(false);
    setPreview(false);
    retain(null, nextDrafts);
    const action = pendingNavigation;
    setPendingNavigation(null);
    action?.();
  }
  function openForm(next: ListForm) {
    requestNavigation(() => {
      const saved = drafts.find((value) => formKey(value) === formKey(next));
      setForm(copy(saved ?? next));
      setError("");
      setReview(false);
      setPreview(false);
      setExample(null);
    });
  }
  function cancelForm() {
    if (!form) return;
    const nextDrafts = drafts.filter(
      (value) => formKey(value) !== formKey(form),
    );
    setDrafts(nextDrafts);
    setForm(null);
    setReview(false);
    setPreview(false);
    setError("");
    retain(null, nextDrafts);
  }
  function questionFor(listId: string) {
    return configuration.items.find(
      (item) =>
        !item.deleted && item.kind === "tasks" && item.listId === listId,
    );
  }
  function editConnection(list: TodoListDefinition) {
    if (!blocks.length || reviewRetainedLists) return;
    const original = questionFor(list.id);
    const item: ChecklistItem = original
      ? copy(original)
      : {
          ...editorItem(
            "tasks",
            blocks[0].id,
            configuration.items.filter(
              (value) => !value.deleted && value.blockId === blocks[0].id,
            ).length,
          ),
          label: `Worked on ${list.title} tasks?`,
          listId: list.id,
          visibility: "relevant",
          followups: [
            {
              id: createId(),
              kind: "note",
              label: "Why?",
              condition: { op: "equals", field: "value", value: false },
              initiallyExpanded: true,
            },
          ],
        };
    openForm({
      kind: "connection",
      before: original ?? null,
      value: item,
      isNew: !original,
    });
  }
  function connectionConfiguration(item: ChecklistItem) {
    return normalizedOrders({
      ...configuration,
      lists,
      items: configuration.items.some((value) => value.id === item.id)
        ? configuration.items.map((value) =>
            value.id === item.id ? item : value,
          )
        : [...configuration.items, item],
    });
  }
  async function saveLists(
    next: TodoListDefinition[],
    completedForm?: ListForm,
  ) {
    const backup = completedForm ?? null;
    const nextDrafts = completedForm
      ? drafts.filter((value) => formKey(value) !== formKey(completedForm))
      : drafts;
    setBusy(true);
    setError("");
    if (completedForm) {
      setForm(null);
      setDrafts(nextDrafts);
      retain(null, nextDrafts);
    }
    try {
      await onSaveLists(next, baseRevision);
      setLists(next);
    } catch (reason) {
      if (backup) {
        setForm(backup);
        retain(backup, nextDrafts);
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save lists. Your changes are still here.",
      );
      if (reorderSnapshot.current) setLists(reorderSnapshot.current);
    } finally {
      setBusy(false);
    }
  }
  function saveListForm() {
    if (form?.kind !== "list" || unresolved) return;
    const current = lists.find((list) => list.id === form.value.id);
    if (!form.isNew && (!current || current.deleted)) {
      setError(
        "This list is no longer active. Cancel this edit to review your lists.",
      );
      return;
    }
    const merged =
      form.before && current
        ? applyEditorFormChanges(form.before, form.value, current)
        : form.value;
    const value = { ...merged, title: merged.title.trim() };
    const next = lists.some((list) => list.id === value.id)
      ? lists.map((list) => (list.id === value.id ? value : list))
      : [...lists, value];
    const errors = validateConfiguration({ ...configuration, lists: next });
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    void saveLists(next, form);
  }
  function reviewConnection() {
    if (form?.kind !== "connection" || unresolved) return;
    const current = configuration.items.find(
      (item) => item.id === form.value.id,
    );
    if (!form.isNew && (!current || current.deleted)) {
      setError(
        "This daily question is no longer active. Cancel this edit to review your lists.",
      );
      return;
    }
    const merged =
      form.before && current
        ? applyEditorFormChanges(form.before, form.value, current)
        : form.value;
    const value = normalizeEditorItem(current, {
      ...merged,
      label: merged.label.trim(),
    });
    const errors = validateConfiguration(connectionConfiguration(value));
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    setForm({ ...form, value });
    setError("");
    setReview(true);
  }
  async function saveConnection(date: string) {
    if (form?.kind !== "connection" || unresolved) return;
    const backup = form;
    const nextDrafts = drafts.filter(
      (value) => formKey(value) !== formKey(form),
    );
    setBusy(true);
    setError("");
    setForm(null);
    setDrafts(nextDrafts);
    retain(null, nextDrafts);
    try {
      await onSaveConnection(
        connectionConfiguration(form.value),
        date,
        baseRevision,
      );
      setReview(false);
    } catch (reason) {
      setForm(backup);
      retain(backup, nextDrafts);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the daily question. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  function archive(list: TodoListDefinition) {
    if (
      !window.confirm(
        `Archive ${list.title}? Its tasks and past accomplishments will be retained.`,
      )
    )
      return;
    void saveLists(
      lists.map((value) =>
        value.id === list.id ? { ...value, deleted: true } : value,
      ),
    );
  }
  function restore(list: TodoListDefinition) {
    if (!window.confirm(`Restore ${list.title} and its tasks to active use?`))
      return;
    void saveLists(
      lists.map((value) =>
        value.id === list.id
          ? { ...value, deleted: false, order: active.length }
          : value,
      ),
    );
  }

  const connectionList =
    form?.kind === "connection"
      ? lists.find((list) => list.id === form.value.listId)
      : null;
  const formTitle =
    form?.kind === "list"
      ? form.isNew
        ? "New To-do list"
        : form.value.title || "Edit list"
      : (connectionList?.title ?? "Daily question");
  const breadcrumb = form ? (
    <>
      <span>To-do lists</span>
      <span aria-hidden="true"> → </span>
      <strong>{formTitle}</strong>
      {form.kind === "connection" && (
        <>
          <span aria-hidden="true"> → </span>
          <span>
            {preview
              ? "Preview"
              : review
                ? "Review question"
                : "Daily question"}
          </span>
        </>
      )}
    </>
  ) : undefined;
  const handleBack = () => {
    if (preview) {
      setPreview(false);
      return;
    }
    if (review) {
      setReview(false);
      return;
    }
    requestNavigation(() => {});
  };
  const footer = removed ? (
    <div className="editor-actions">
      <button type="button" onClick={cancelForm}>
        Cancel
      </button>
    </div>
  ) : form ? (
    <div className="editor-actions">
      <button
        type="button"
        disabled={busy}
        onClick={
          preview
            ? () => setPreview(false)
            : review
              ? () => setReview(false)
              : cancelForm
        }
      >
        {preview ? "Back to question" : review ? "Back to question" : "Cancel"}
      </button>
      {preview ? null : form.kind === "list" ? (
        <button
          type="button"
          className="editor-primary"
          disabled={busy || unresolved || !form.value.title.trim()}
          onClick={saveListForm}
        >
          {busy ? "Saving…" : "Save list"}
        </button>
      ) : review ? (
        <>
          <button
            type="button"
            disabled={busy || unresolved}
            onClick={() => void saveConnection(addDays(today, 1))}
          >
            Start next day
          </button>
          <button
            type="button"
            className="editor-primary"
            disabled={busy || unresolved}
            onClick={() => void saveConnection(today)}
          >
            Apply today
          </button>
        </>
      ) : (
        <button
          type="button"
          className="editor-primary"
          disabled={busy || unresolved || !form.value.label.trim()}
          onClick={reviewConnection}
        >
          Done
        </button>
      )}
    </div>
  ) : (
    <div className="editor-actions">
      <button type="button" disabled={busy} onClick={onClose}>
        Done
      </button>
    </div>
  );

  return (
    <EditorWorkspace
      title="Edit To-Do lists"
      subtitle={form ? undefined : "Make room for the things you want to do."}
      breadcrumb={breadcrumb}
      onBack={form ? handleBack : undefined}
      onClose={() => requestNavigation(onClose)}
      headerActions={
        form?.kind === "connection" && !removed && !review && !preview ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setExample(defaultAnswer(form.value));
              setPreview(true);
            }}
          >
            Preview
          </button>
        ) : undefined
      }
      footer={footer}
    >
      {form && unresolved && (
        <section
          className="editor-notice"
          role="alert"
          aria-label="Review recovered edit"
        >
          <h3>
            {removed
              ? "This is no longer active"
              : "This changed on another device"}
          </h3>
          <p>
            {removed
              ? "The list or daily question was removed while this edit was unfinished. Cancel this edit to review the latest settings."
              : "Your unfinished edit and the latest settings changed the same fields. Choose which changes to keep before saving."}
          </p>
          {!removed && (
            <div className="editor-actions">
              <button type="button" onClick={() => resolveConflict(true)}>
                Keep my changes
              </button>
              <button type="button" onClick={() => resolveConflict(false)}>
                Use latest settings
              </button>
            </div>
          )}
        </section>
      )}
      {draftError && (
        <p className="editor-notice" role="alert">
          {draftError}
        </p>
      )}
      {error && (
        <p className="editor-notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="editor-muted" role="status">
          Saving…
        </p>
      )}
      {!form ? (
        <>
          {reviewRetainedLists && (
            <section
              className="editor-notice"
              aria-label="Retained list changes"
            >
              <h3>Review retained list changes</h3>
              <p>
                Your retained list changes are shown below. Save them before
                editing daily questions.
              </p>
              {hasRetainedChecklistChanges && (
                <p>Your checklist draft stays separate.</p>
              )}
              <button
                type="button"
                className="editor-primary"
                disabled={busy}
                onClick={() => void saveLists(lists)}
              >
                Save retained list changes
              </button>
            </section>
          )}
          {!reviewRetainedLists && hasRetainedChecklistChanges && (
            <section
              className="editor-notice"
              aria-label="Retained checklist draft"
            >
              <p>You also have a checklist draft.</p>
              {onReviewChecklist && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => requestNavigation(onReviewChecklist)}
                >
                  Review checklist draft
                </button>
              )}
            </section>
          )}
          <div className="editor-main-heading">
            <div>
              <h2>Your To-do lists</h2>
              <p className="editor-muted">List changes save immediately.</p>
            </div>
            <button
              type="button"
              className="editor-button editor-primary"
              disabled={busy}
              onClick={() =>
                openForm({
                  kind: "list",
                  before: null,
                  value: {
                    id: createId(),
                    title: "",
                    icon: "circle",
                    order: active.length,
                  },
                  isNew: true,
                })
              }
            >
              <Plus size={16} aria-hidden="true" /> Add To-do list
            </button>
          </div>
          {!active.length && (
            <p className="editor-empty">
              No To-do lists yet. Add a list to get started.
            </p>
          )}
          <div className="editor-rows" aria-label="Active To-do lists">
            {active.map((list, index) => {
              const question = questionFor(list.id);
              const unfinished = drafts.some(
                (draft) =>
                  (draft.kind === "list"
                    ? draft.value.id
                    : draft.value.listId) === list.id,
              );
              return (
                <section
                  key={list.id}
                  className="editor-row"
                  aria-label={`${list.title} list`}
                  data-reorder-card="list"
                >
                  <CustomizationIcon name={list.icon} />
                  <button
                    type="button"
                    className="editor-row-main"
                    aria-label={`Edit ${list.title}`}
                    disabled={busy}
                    onClick={() =>
                      openForm({
                        kind: "list",
                        before: list,
                        value: list,
                        isNew: false,
                      })
                    }
                  >
                    <span className="editor-row-title">{list.title}</span>
                    <span className="editor-row-meta">
                      {question
                        ? "Connected to daily checklist"
                        : "No daily question"}
                      {unfinished ? " · Unfinished edits" : ""}
                    </span>
                  </button>
                  <div className="editor-row-actions">
                    <ReorderHandle
                      label={`${list.title} list`}
                      first={index === 0}
                      last={index === active.length - 1}
                      disabled={busy}
                      onStart={() => {
                        reorderSnapshot.current = copy(lists);
                      }}
                      onMove={(direction) =>
                        setLists((current) =>
                          reordered(current, list.id, direction),
                        )
                      }
                      onEnd={(cancelled, moved) => {
                        if (cancelled && reorderSnapshot.current)
                          setLists(reorderSnapshot.current);
                        else if (moved) void saveLists(lists);
                        reorderSnapshot.current = null;
                      }}
                    />
                    <details className="editor-overflow">
                      <summary aria-label={`Actions for ${list.title}`}>
                        <MoreHorizontal size={19} aria-hidden="true" />
                      </summary>
                      <div>
                        <button
                          type="button"
                          disabled={
                            busy || !blocks.length || reviewRetainedLists
                          }
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            editConnection(list);
                          }}
                        >
                          {question
                            ? "Edit daily question"
                            : "Connect to daily checklist"}
                        </button>
                        <button
                          type="button"
                          className="editor-danger"
                          disabled={busy}
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            archive(list);
                          }}
                        >
                          Archive list
                        </button>
                      </div>
                    </details>
                  </div>
                </section>
              );
            })}
          </div>
          {drafts.length > 0 && (
            <section
              className="editor-notice"
              aria-label="Unfinished list edits"
            >
              <h3>Unfinished edits</h3>
              {drafts.map((draft) => (
                <div className="editor-actions" key={formKey(draft)}>
                  <span>
                    {draft.kind === "list"
                      ? draft.value.title || "New list"
                      : `${lists.find((list) => list.id === draft.value.listId)?.title ?? "List"} daily question`}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openForm(draft)}
                  >
                    Continue editing
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setDrafts((values) =>
                        values.filter(
                          (value) => formKey(value) !== formKey(draft),
                        ),
                      )
                    }
                  >
                    Discard
                  </button>
                </div>
              ))}
            </section>
          )}
          {archived.length > 0 && (
            <details className="editor-archived">
              <summary>Archived lists ({archived.length})</summary>
              <p className="editor-muted">
                Their tasks and past accomplishments are retained.
              </p>
              <div className="editor-rows">
                {archived.map((list) => (
                  <section key={list.id} className="editor-row">
                    <CustomizationIcon name={list.icon} />
                    <span className="editor-row-title editor-row-main">
                      {list.title}
                    </span>
                    <button
                      type="button"
                      className="editor-button"
                      disabled={busy}
                      onClick={() => restore(list)}
                    >
                      Restore {list.title}
                    </button>
                  </section>
                ))}
              </div>
            </details>
          )}
          {!blocks.length && (
            <p className="editor-notice">
              Create a checklist block before connecting a list to a daily
              question.
            </p>
          )}
        </>
      ) : removed ? null : form.kind === "list" ? (
        <section className="editor-form" aria-label="List editor">
          <div className="editor-main-heading">
            <h2>{form.isNew ? "New To-do list" : "Edit list"}</h2>
          </div>
          <div className="editor-fields">
            <Field label="List title">
              <input
                autoFocus
                value={form.value.title}
                onChange={(event) =>
                  setForm({
                    ...form,
                    value: { ...form.value, title: event.target.value },
                  })
                }
              />
            </Field>
            <IconSelect
              label="List icon"
              value={form.value.icon}
              onChange={(icon) =>
                setForm({ ...form, value: { ...form.value, icon } })
              }
            />
          </div>
        </section>
      ) : preview ? (
        <section className="editor-form" aria-label="Daily question preview">
          <div className="editor-main-heading">
            <h2>Daily question preview</h2>
            <button
              type="button"
              className="editor-button"
              onClick={() => setExample(defaultAnswer(form.value))}
            >
              Reset examples
            </button>
          </div>
          <Field label="Preview date">
            <input
              type="date"
              value={previewDate}
              onChange={(event) => setPreviewDate(event.target.value || today)}
            />
          </Field>
          {scheduleMatches(form.value.schedule, previewDate) &&
          scheduleMatches(
            blocks.find((block) => block.id === form.value.blockId)?.schedule,
            previewDate,
          ) ? (
            <>
              <p className="editor-muted">
                {evaluateItem(form.value, example ?? defaultAnswer(form.value))
                  .complete
                  ? "1 / 1 check"
                  : "0 / 1 checks"}
              </p>
              <ChecklistItemInput
                item={form.value}
                answer={example ?? defaultAnswer(form.value)}
                onChange={setExample}
                preview
                taskContent={
                  <p className="editor-muted">
                    Tasks from {connectionList?.title ?? "this list"} appear
                    here.
                  </p>
                }
              />
            </>
          ) : (
            <p className="editor-empty">
              This question is not scheduled for this date.
            </p>
          )}
        </section>
      ) : review ? (
        <section className="editor-form" aria-label="Review daily question">
          <h2>
            {form.value.deleted
              ? "Disconnect daily question"
              : form.isNew
                ? "Add daily question"
                : "Update daily question"}
          </h2>
          <p>
            <strong>{form.value.label}</strong>
          </p>
          <p className="editor-muted">
            {blocks.find((block) => block.id === form.value.blockId)?.title} ·{" "}
            {form.value.visibility === "always"
              ? "Always show on scheduled days"
              : "Show when relevant"}
          </p>
          <p>
            {form.value.deleted
              ? "The question stops appearing from the date you choose. Earlier answers stay available."
              : "Choose when this daily question changes. Earlier days keep their original question."}
          </p>
        </section>
      ) : (
        <section className="editor-form" aria-label="Daily question connection">
          <div className="editor-main-heading">
            <div>
              <h2>Daily question</h2>
              <p className="editor-muted">
                Connected to {connectionList?.title ?? "this list"}.
              </p>
            </div>
            {form.before && (
              <details className="editor-overflow">
                <summary aria-label="Daily question actions">
                  <MoreHorizontal size={19} aria-hidden="true" />
                </summary>
                <div>
                  <button
                    type="button"
                    className="editor-danger"
                    disabled={unresolved}
                    onClick={() => {
                      setForm({
                        ...form,
                        value: { ...form.value, deleted: !form.value.deleted },
                      });
                      setReview(true);
                    }}
                  >
                    {form.value.deleted
                      ? "Keep connection"
                      : "Disconnect question"}
                  </button>
                </div>
              </details>
            )}
          </div>
          <ChecklistItemEditor
            item={form.value}
            original={form.before ?? undefined}
            blocks={blocks}
            lists={active}
            fixedConnection
            onChange={(value) =>
              setForm({
                ...form,
                value: normalizeEditorItem(form.before ?? undefined, {
                  ...value,
                  kind: "tasks",
                  listId: form.value.listId,
                }),
              })
            }
          />
        </section>
      )}
      {pendingNavigation && (
        <Modal
          title="Keep your unfinished edits?"
          role="alertdialog"
          onClose={() => setPendingNavigation(null)}
        >
          <p>Save them as a local draft, or discard just this edit.</p>
          <div className="dialog-actions">
            <button
              type="button"
              autoFocus
              onClick={() => setPendingNavigation(null)}
            >
              Keep editing
            </button>
            <button type="button" onClick={() => leaveForm("discard")}>
              Discard item edits
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => leaveForm("save")}
            >
              Save to draft
            </button>
          </div>
        </Modal>
      )}
    </EditorWorkspace>
  );
}
