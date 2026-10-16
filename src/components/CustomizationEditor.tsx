import { useEffect, useId, useRef, useState } from "react";
import {
  applyEditorFormChanges,
  resolveEditorFormConflicts,
} from "../lib/editorRecovery";
import { Eye, Plus, MoreHorizontal, ArrowRight } from "lucide-react";
import type {
  ChecklistBlockDefinition,
  ChecklistItem,
  Configuration,
  ItemAnswer,
  ItemAnswers,
  ItemKind,
  TodoListDefinition,
} from "../lib/customizationTypes";
import type {
  EditorRecoveryForm,
  EditorRecoveryState,
} from "../lib/editorRecovery";
import {
  defaultAnswer,
  evaluateItem,
  itemAnswerKey,
  customChecklistProgress,
  scheduleMatches,
  validateConfiguration,
} from "../lib/customization";
import {
  normalizedOrders,
  reordered,
  editorItem,
  duplicateEditorItem,
  normalizeEditorItem,
  originalMainInput,
  mainInputError,
  newMainInputError,
  summarizeItem,
  summarizeSchedule,
} from "../lib/editorPresentation";
import { addDays } from "../lib/dates";
import { createId } from "../lib/model";
import { ChecklistBlock, Modal } from "./Controls";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { CustomizationIcon } from "./CustomizationIcon";
import { ChecklistItemEditor, AnswerTypePicker } from "./ChecklistItemEditor";
import { Field, IconSelect, ScheduleEditor } from "./EditorFields";
import { EditorWorkspace } from "./EditorWorkspace";
import { ReorderHandle } from "./ReorderHandle";
import "./Customization.css";

export {
  ManageTodoLists,
  type ManageTodoListsProps,
} from "./TodoListWorkspace";
export { CustomizationIcon } from "./CustomizationIcon";

const copy = <T,>(value: T): T => structuredClone(value);
const sort = <T extends { order: number }>(values: T[]) =>
  [...values].sort((a, b) => a.order - b.order);
const previewKey = (item: ChecklistItem) =>
  `${itemAnswerKey(item)}:${JSON.stringify([item.kind, item.options?.map((option) => option.id), item.followups.map((field) => [field.id, field.kind, field.options?.map((option) => option.id)])])}`;
const conflictLabels: Record<string, string> = {
  label: "question",
  title: "name",
  kind: "answer type",
  completion: "completion goal",
  followups: "extra questions",
  helper: "help text",
  schedule: "schedule",
  icon: "icon",
  min: "allowed minimum",
  max: "allowed maximum",
  listId: "connected list",
  visibility: "visibility",
  options: "choices",
};
type ChecklistForm =
  | Extract<EditorRecoveryForm, { kind: "block" }>
  | Extract<EditorRecoveryForm, { kind: "item" | "connection" }>;
type Screen =
  "navigation" | "overview" | "form" | "choose" | "preview" | "review";

export interface CustomizationEditorProps {
  configuration: Configuration;
  today: string;
  baseRevision: number;
  initialDraft?: Configuration;
  answers?: ItemAnswers;
  relevance?: Record<string, boolean>;
  retainedListChanges?: TodoListDefinition[];
  recovery?: EditorRecoveryState;
  onRecoveryChange?: (state: EditorRecoveryState | null) => void;
  draftError?: string;
  onDraftChange?: (configuration: Configuration) => void;
  onSave: (
    configuration: Configuration,
    effectiveDate: string,
    baseRevision: number,
  ) => Promise<void> | void;
  onClose: () => void;
}

export function CustomizationEditor({
  configuration,
  today,
  baseRevision,
  initialDraft,
  answers = {},
  relevance = {},
  retainedListChanges = [],
  recovery,
  onRecoveryChange,
  draftError,
  onDraftChange,
  onSave,
  onClose,
}: CustomizationEditorProps) {
  const [draft, setDraft] = useState(() => copy(initialDraft ?? configuration));
  const [selection, setSelection] = useState(
    recovery?.selectionId ??
      sort(
        (initialDraft ?? configuration).blocks.filter(
          (block) => !block.deleted,
        ),
      )[0]?.id,
  );
  const recoveredForm =
    recovery?.form?.kind === "item" || recovery?.form?.kind === "block"
      ? recovery.form
      : null;
  const [form, setForm] = useState<ChecklistForm | null>(() =>
    recoveredForm ? copy(recoveredForm) : null,
  );
  const [screen, setScreen] = useState<Screen>(
    recoveredForm ? "form" : (recovery?.level ?? "navigation"),
  );
  const [recovered, setRecovered] = useState(!!recoveredForm);
  const [previewDate, setPreviewDate] = useState(today);
  const [previewAnswers, setPreviewAnswers] = useState<ItemAnswers>({});
  const [previewWhole, setPreviewWhole] = useState(false);
  const returnScreen = useRef<Screen>("overview");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [move, setMove] = useState<{
    item: ChecklistItem;
    destination: string;
  } | null>(null);
  const reorderSnapshot = useRef<Configuration | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const originalRevision = useState(baseRevision)[0];
  const scope = useId();
  const blocks = sort(draft.blocks.filter((block) => !block.deleted));
  const block = blocks.find((value) => value.id === selection) ?? blocks[0];
  const items = sort(
    draft.items.filter((item) => item.blockId === block?.id && !item.deleted),
  );
  const dirtyForm =
    !!form &&
    (form.isNew || JSON.stringify(form.before) !== JSON.stringify(form.value));

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  useEffect(() => {
    onRecoveryChange?.({
      section: "checklist",
      selectionId: selection,
      level: form
        ? "form"
        : screen === "navigation"
          ? "navigation"
          : "overview",
      form: form ?? undefined,
      baseRevision: originalRevision,
    });
  }, [selection, screen, form, originalRevision, onRecoveryChange]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const panel = heading.current?.closest<HTMLElement>(
      "[data-reorder-scroll]",
    );
    if (panel) panel.scrollTop = 0;
  }, [screen, selection, form?.value.id]);

  function navigate(action: () => void) {
    if (busy) return;
    if (dirtyForm) setPendingNavigation(() => action);
    else {
      setForm(null);
      setError("");
      action();
    }
  }
  function openBlock(id: string) {
    navigate(() => {
      setSelection(id);
      setScreen("overview");
    });
  }
  function editItem(item: ChecklistItem, isNew = false) {
    setForm({
      kind: "item",
      before: isNew ? null : copy(item),
      value: copy(item),
      isNew,
    });
    setScreen("form");
    setError("");
    setRecovered(false);
  }
  function editBlock(value?: ChecklistBlockDefinition) {
    const next = value ?? {
      id: createId(),
      title: "",
      icon: "circle",
      order: blocks.length,
    };
    navigate(() => {
      setForm({
        kind: "block",
        before: value ? copy(value) : null,
        value: copy(next),
        isNew: !value,
      });
      setScreen("form");
      setRecovered(false);
      setError("");
    });
  }
  function candidateFor(current: ChecklistForm) {
    if (current.kind === "block") {
      return {
        ...draft,
        blocks: current.isNew
          ? [...draft.blocks, current.value]
          : draft.blocks.map((value) =>
              value.id === current.value.id
                ? applyEditorFormChanges(current.before, current.value, value)
                : value,
            ),
      };
    }
    let item = normalizeEditorItem(
      configuration.items.find((value) => value.id === current.value.id),
      current.isNew
        ? copy(current.value)
        : applyEditorFormChanges(
            current.before,
            current.value,
            draft.items.find((value) => value.id === current.value.id) ??
              current.value,
          ),
    );
    if (current.isNew || current.before?.blockId !== item.blockId)
      item = {
        ...item,
        order:
          Math.max(
            -1,
            ...draft.items
              .filter(
                (value) =>
                  value.blockId === item.blockId &&
                  value.id !== item.id &&
                  !value.deleted,
              )
              .map((value) => value.order),
          ) + 1,
      };
    return {
      ...draft,
      items: current.isNew
        ? [...draft.items, item]
        : draft.items.map((value) => (value.id === item.id ? item : value)),
    };
  }
  function finishForm() {
    if (!form) return true;
    if (form.conflicts?.length) {
      setError("Review the recovered settings before choosing Done.");
      return false;
    }
    if (form.kind !== "block" && !originalMainInput(form.value.kind)) {
      setError(mainInputError(form.value));
      return false;
    }
    const candidate = candidateFor(form);
    const errors = validateConfiguration(candidate);
    if (errors.length) {
      setError(errors[0]);
      return false;
    }
    setDraft(candidate);
    const nextSelection =
      form.kind === "block" ? form.value.id : form.value.blockId;
    onDraftChange?.(candidate);
    onRecoveryChange?.({
      section: "checklist",
      selectionId: nextSelection,
      level: "overview",
      baseRevision: originalRevision,
    });
    setSelection(nextSelection);
    setForm(null);
    setError("");
    setRecovered(false);
    setScreen("overview");
    return true;
  }
  function discardForm() {
    onRecoveryChange?.({
      section: "checklist",
      selectionId: selection,
      level: block ? "overview" : "navigation",
      baseRevision: originalRevision,
    });
    setForm(null);
    setError("");
    setRecovered(false);
    setScreen(block ? "overview" : "navigation");
  }
  function removeItem(item: ChecklistItem) {
    if (
      !window.confirm(
        `Remove “${item.label}”? Earlier answers will remain available.`,
      )
    )
      return;
    setDraft((value) => ({
      ...value,
      items: value.items.map((candidate) =>
        candidate.id === item.id ? { ...candidate, deleted: true } : candidate,
      ),
    }));
  }
  function removeBlock() {
    if (
      !block ||
      !window.confirm(
        `Remove “${block.title}” and its items? Earlier days will remain available.`,
      )
    )
      return;
    const remaining = blocks.filter((value) => value.id !== block.id);
    const index = blocks.findIndex((value) => value.id === block.id);
    setDraft((value) => ({
      ...value,
      blocks: value.blocks.map((candidate) =>
        candidate.id === block.id ? { ...candidate, deleted: true } : candidate,
      ),
      items: value.items.map((item) =>
        item.blockId === block.id ? { ...item, deleted: true } : item,
      ),
    }));
    setSelection(remaining[Math.min(index, remaining.length - 1)]?.id);
    setScreen(remaining.length ? "overview" : "navigation");
  }
  function openPreview() {
    returnScreen.current = screen;
    setPreviewWhole(false);
    setScreen("preview");
  }
  const effectiveDraft = form ? candidateFor(form) : draft;
  const previewBlocks = sort(
    effectiveDraft.blocks.filter(
      (value) => !value.deleted && scheduleMatches(value.schedule, previewDate),
    ),
  );
  const previewItem = form && form.kind !== "block" ? form.value : null;
  const changed = (["blocks", "items"] as const).flatMap((kind) =>
    draft[kind].flatMap((value) => {
      const before = configuration[kind].find(
        (original) => original.id === value.id,
      );
      if (JSON.stringify(value) === JSON.stringify(before)) return [];
      const title = "label" in value ? value.label : value.title;
      return [
        {
          id: value.id,
          title,
          action: value.deleted ? "Removed" : before ? "Changed" : "Added",
          reset:
            "generation" in value &&
            before &&
            "generation" in before &&
            value.generation !== before.generation,
        },
      ];
    }),
  );
  const beforeProgress = customChecklistProgress(
    configuration,
    answers,
    today,
    relevance,
  );
  const afterProgress = customChecklistProgress(
    draft,
    answers,
    today,
    relevance,
  );
  async function publish(date: string) {
    const inputError = newMainInputError(configuration, draft);
    if (inputError) {
      setError(inputError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(normalizedOrders(draft), date, originalRevision);
      onRecoveryChange?.(null);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Your draft is retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  const startReorder = () => {
    reorderSnapshot.current = draft;
  };
  const endReorder = (cancelled: boolean) => {
    if (cancelled && reorderSnapshot.current) setDraft(reorderSnapshot.current);
    reorderSnapshot.current = null;
  };
  const back = () => {
    if (screen === "preview") {
      setScreen(returnScreen.current);
      return;
    }
    if (screen === "review") {
      setScreen("overview");
      return;
    }
    navigate(() =>
      setScreen(
        screen === "form" || screen === "choose" ? "overview" : "navigation",
      ),
    );
  };
  const sidebar = (
    <nav aria-label="Checklist blocks">
      <div className="editor-nav-heading">
        <h2>Blocks</h2>
        <button
          type="button"
          className="editor-icon-button"
          aria-label="Add block"
          onClick={() => editBlock()}
        >
          <Plus size={19} />
        </button>
      </div>
      {blocks.map((value, index) => (
        <div
          className={`editor-nav-row${value.id === block?.id ? " selected" : ""}`}
          key={value.id}
          data-reorder-card="block"
        >
          <button
            type="button"
            className="editor-nav-select"
            aria-label={`Open ${value.title}`}
            aria-current={value.id === block?.id ? "true" : undefined}
            onClick={() => openBlock(value.id)}
          >
            <CustomizationIcon name={value.icon} />
            <span>
              {value.title}
              <small>
                {
                  draft.items.filter(
                    (item) => item.blockId === value.id && !item.deleted,
                  ).length
                }{" "}
                items
              </small>
            </span>
          </button>
          <ReorderHandle
            label={value.title}
            first={index === 0}
            last={index === blocks.length - 1}
            disabled={busy}
            onStart={startReorder}
            onEnd={endReorder}
            onMove={(direction) =>
              setDraft((current) => ({
                ...current,
                blocks: reordered(current.blocks, value.id, direction),
              }))
            }
          />
        </div>
      ))}
      {!blocks.length && (
        <p className="editor-empty">Add your first block to get started.</p>
      )}
      <button
        type="button"
        className="editor-add-row"
        onClick={() => editBlock()}
      >
        <Plus size={16} />
        Add block
      </button>
    </nav>
  );
  const formTitle =
    form?.kind === "block"
      ? form.value.title || "New block"
      : form?.value.label || "New item";
  const activeTitle =
    screen === "review"
      ? "Review changes"
      : screen === "preview"
        ? "Preview"
        : screen === "choose"
          ? "Choose an answer type"
          : screen === "form"
            ? formTitle
            : (block?.title ?? "Your checklist");
  const context =
    screen === "form" ? (
      <>
        <span>
          {form?.kind === "block"
            ? "Blocks"
            : (blocks.find((value) => value.id === form?.value.blockId)
                ?.title ?? block?.title)}
        </span>
        <ArrowRight size={13} />
        <strong>{formTitle}</strong>
      </>
    ) : screen === "preview" ? (
      <span>
        Preview ·{" "}
        {previewWhole
          ? "Whole checklist"
          : (previewItem?.label ?? block?.title)}
      </span>
    ) : undefined;
  return (
    <>
      <EditorWorkspace
        title="Edit Daily Checklist"
        subtitle={draftError ? "Draft could not be saved" : "Draft"}
        sidebar={sidebar}
        showSidebar={screen === "navigation"}
        breadcrumb={context}
        onBack={back}
        backLabel={
          screen === "preview"
            ? "Back to editor"
            : screen === "form" || screen === "choose"
              ? (block?.title ?? "Blocks")
              : screen === "review"
                ? "Back to checklist"
                : "Blocks"
        }
        onClose={() => {
          if (!busy) navigate(onClose);
        }}
        headerActions={
          screen !== "review" &&
          screen !== "choose" &&
          screen !== "preview" && (
            <button
              type="button"
              className="editor-button"
              onClick={openPreview}
            >
              <Eye size={16} />
              Preview
            </button>
          )
        }
        footer={
          screen === "preview" ? (
            <span className="editor-muted">
              Example answers only · Your daily records stay unchanged.
            </span>
          ) : screen === "form" || screen === "choose" ? (
            <div className="editor-actions">
              <span className="editor-muted">
                {form?.kind === "block" ? "Block" : "Item"} changes stay in your
                draft.
              </span>
              <button
                type="button"
                className="editor-button"
                onClick={discardForm}
              >
                Cancel
              </button>
              {form && (
                <button
                  type="button"
                  className="editor-button editor-primary"
                  onClick={finishForm}
                >
                  Done
                </button>
              )}
            </div>
          ) : screen === "review" ? (
            <div className="editor-actions">
              <button
                type="button"
                className="editor-button"
                disabled={busy}
                onClick={() => void publish(addDays(today, 1))}
              >
                Start next day
              </button>
              <button
                type="button"
                className="editor-button editor-primary"
                disabled={busy}
                onClick={() => void publish(today)}
              >
                {busy ? "Saving…" : "Apply today"}
              </button>
            </div>
          ) : (
            <div className="editor-actions">
              <button
                type="button"
                className="editor-button editor-subtle"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Discard the checklist draft?")) {
                    setDraft(copy(configuration));
                    setForm(null);
                    setPreviewAnswers({});
                    setError("");
                    onRecoveryChange?.(null);
                  }
                }}
              >
                Discard draft
              </button>
              <span className="editor-muted">
                {changed.length
                  ? `${changed.length} ${changed.length === 1 ? "change" : "changes"}`
                  : "No changes yet"}
              </span>
              <button
                type="button"
                className="editor-button editor-primary"
                disabled={busy}
                onClick={() => {
                  setScreen("review");
                  setError("");
                }}
              >
                Review changes
              </button>
            </div>
          )
        }
      >
        <h2 className="editor-main-heading" ref={heading} tabIndex={-1}>
          {activeTitle}
        </h2>
        {(error || draftError) && (
          <p role="alert" className="editor-inline-error">
            {error || draftError}
          </p>
        )}
        {recovered && form && (
          <p className="editor-notice" role="status">
            Recovered unfinished edit. Review it before choosing Done.
          </p>
        )}
        {form?.conflicts?.length ? (
          <section
            className="editor-notice"
            role="alert"
            aria-label="Recovered edit conflicts"
          >
            {form.conflicts.includes("__removed") ? (
              <p>
                This entry was removed elsewhere. Its unfinished edit is
                retained. Cancel to return to the current checklist.
              </p>
            ) : (
              <>
                <p>
                  These settings also changed elsewhere:{" "}
                  {form.conflicts
                    .map((field) => conflictLabels[field] ?? "other settings")
                    .join(", ")}
                  . Choose which version to keep.
                </p>
                <div className="editor-actions">
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => {
                      setForm(
                        resolveEditorFormConflicts(
                          form,
                          false,
                        ) as ChecklistForm,
                      );
                      setError("");
                    }}
                  >
                    Use latest settings
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => {
                      setForm(
                        resolveEditorFormConflicts(form, true) as ChecklistForm,
                      );
                      setError("");
                    }}
                  >
                    Keep my changes
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}
        {retainedListChanges.length > 0 && screen === "review" && (
          <section
            className="editor-notice"
            aria-label="Retained To-do list changes"
          >
            <h3>To-do list changes</h3>
            <p>These apply immediately.</p>
            <ul>
              {retainedListChanges.map((list) => (
                <li key={list.id}>
                  {list.title}
                  {list.deleted ? " · removed" : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(screen === "navigation" || screen === "overview") && block && (
          <section aria-label={`Edit ${block.title}`}>
            <div className="editor-block-toolbar">
              <div className="editor-block-identity">
                <CustomizationIcon name={block.icon} />
                <span>
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
                {block.schedule && (
                  <span className="editor-chip">
                    {summarizeSchedule(block.schedule)}
                  </span>
                )}
              </div>
              <div className="editor-actions">
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => editBlock(block)}
                >
                  Edit block
                </button>
                <details className="editor-overflow">
                  <summary aria-label={`${block.title} block actions`}>
                    <MoreHorizontal size={19} />
                  </summary>
                  <div>
                    <button type="button" onClick={removeBlock}>
                      Remove block
                    </button>
                  </div>
                </details>
              </div>
            </div>
            <div className="editor-rows">
              {items.map((item, index) => (
                <div
                  className="editor-row"
                  data-reorder-card="item"
                  key={item.id}
                >
                  <button
                    type="button"
                    className="editor-row-main"
                    aria-label={`Edit ${item.label}`}
                    onClick={() => editItem(item)}
                  >
                    <span className="editor-row-title">{item.label}</span>
                    <span className="editor-row-meta">
                      {summarizeItem(item)}
                    </span>
                    {(item.schedule || item.followups.length > 0) && (
                      <span className="editor-row-meta">
                        {[
                          item.schedule ? summarizeSchedule(item.schedule) : "",
                          item.followups.length
                            ? `${item.followups.length} extra ${item.followups.length === 1 ? "question" : "questions"}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </button>
                  <div className="editor-row-actions">
                    <ReorderHandle
                      label={item.label}
                      first={index === 0}
                      last={index === items.length - 1}
                      onStart={startReorder}
                      onEnd={endReorder}
                      onMove={(direction) =>
                        setDraft((current) => {
                          const ordered = reordered(
                            current.items.filter(
                              (value) => value.blockId === block.id,
                            ),
                            item.id,
                            direction,
                          );
                          return {
                            ...current,
                            items: current.items.map(
                              (value) =>
                                ordered.find((next) => next.id === value.id) ??
                                value,
                            ),
                          };
                        })
                      }
                    />
                    <details
                      className="editor-overflow"
                      name={`${scope}-item-actions`}
                    >
                      <summary aria-label={`${item.label} actions`}>
                        <MoreHorizontal size={19} />
                      </summary>
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            editItem(duplicateEditorItem(item), true)
                          }
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          disabled={blocks.length < 2}
                          onClick={() =>
                            setMove({
                              item,
                              destination:
                                blocks.find(
                                  (value) => value.id !== item.blockId,
                                )?.id ?? item.blockId,
                            })
                          }
                        >
                          Move to block
                        </button>
                        <button
                          type="button"
                          className="editor-danger"
                          onClick={() => removeItem(item)}
                        >
                          Remove item
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>
            {!items.length && (
              <p className="editor-empty">No items in this block yet.</p>
            )}
            <button
              type="button"
              className="editor-add-row"
              onClick={() => {
                setScreen("choose");
                setError("");
              }}
            >
              <Plus size={17} />
              Add item
            </button>
          </section>
        )}
        {!block && screen !== "form" && (
          <div className="editor-empty">
            <p>Create a block for a part of your routine.</p>
            <button
              type="button"
              className="editor-button editor-primary"
              onClick={() => editBlock()}
            >
              Add block
            </button>
          </div>
        )}
        {screen === "choose" && block && (
          <AnswerTypePicker
            onChoose={(kind: ItemKind) =>
              editItem(editorItem(kind, block.id, items.length), true)
            }
            onCancel={() => setScreen("overview")}
          />
        )}
        {screen === "form" && form?.kind === "block" && (
          <div className="editor-form">
            <Field label="Block name">
              <input
                autoFocus
                value={form.value.title}
                maxLength={500}
                onChange={(event) =>
                  setForm({
                    ...form,
                    value: { ...form.value, title: event.target.value },
                  })
                }
              />
            </Field>
            <IconSelect
              label="Block icon"
              value={form.value.icon}
              onChange={(icon) =>
                setForm({ ...form, value: { ...form.value, icon } })
              }
            />
            <details className="editor-advanced">
              <summary>
                Advanced
                <span>
                  {form.value.schedule
                    ? summarizeSchedule(form.value.schedule)
                    : "Every day"}
                </span>
              </summary>
              <section className="editor-form-section">
                <h3>When this block appears</h3>
                <ScheduleEditor
                  schedule={form.value.schedule}
                  onChange={(schedule) =>
                    setForm({ ...form, value: { ...form.value, schedule } })
                  }
                />
              </section>
            </details>
          </div>
        )}
        {screen === "form" && form && form.kind !== "block" && (
          <ChecklistItemEditor
            key={form.value.id}
            item={form.value}
            original={configuration.items.find(
              (value) => value.id === form.value.id,
            )}
            blocks={blocks}
            lists={draft.lists.filter((list) => !list.deleted)}
            onChange={(value) => {
              const beforeKey = previewKey(form.value),
                afterKey = previewKey(value);
              if (beforeKey !== afterKey)
                setPreviewAnswers((current) => {
                  const next = { ...current };
                  delete next[beforeKey];
                  delete next[afterKey];
                  return next;
                });
              setForm({ ...form, value });
            }}
          />
        )}
        {screen === "preview" && (
          <section className="editor-preview" aria-label="Checklist preview">
            <div className="editor-preview-controls">
              <Field label="Preview scope">
                <select
                  value={previewWhole ? "whole" : "context"}
                  onChange={(event) =>
                    setPreviewWhole(event.target.value === "whole")
                  }
                >
                  <option value="context">
                    {previewItem ? "This item" : "This block"}
                  </option>
                  <option value="whole">Whole checklist</option>
                </select>
              </Field>
              <Field label="Preview date">
                <input
                  type="date"
                  value={previewDate}
                  onChange={(event) =>
                    setPreviewDate(event.target.value || today)
                  }
                />
              </Field>
              <button
                type="button"
                className="editor-button"
                onClick={() => setPreviewAnswers({})}
              >
                Reset examples
              </button>
            </div>
            {previewBlocks
              .filter(
                (value) =>
                  previewWhole ||
                  value.id === (previewItem?.blockId ?? block?.id),
              )
              .map((value) => {
                const visible = sort(
                  effectiveDraft.items.filter(
                    (item) =>
                      !item.deleted &&
                      item.blockId === value.id &&
                      (previewWhole ||
                        !previewItem ||
                        item.id === previewItem.id) &&
                      evaluateItem(
                        item,
                        previewAnswers[previewKey(item)] ?? defaultAnswer(item),
                        previewDate,
                        { block: value, relevant: true },
                      ).visible,
                  ),
                );
                if (!visible.length) return null;
                return (
                  <ChecklistBlock
                    key={value.id}
                    title={value.title}
                    preferenceKey={`preview:${scope}:${value.id}`}
                    collapsible={false}
                    icon={<CustomizationIcon name={value.icon} />}
                    progress={{
                      total: visible.length,
                      completed: visible.filter(
                        (item) =>
                          evaluateItem(
                            item,
                            previewAnswers[previewKey(item)] ??
                              defaultAnswer(item),
                          ).complete,
                      ).length,
                    }}
                  >
                    {visible.map((item) => (
                      <ChecklistItemInput
                        key={itemAnswerKey(item)}
                        item={item}
                        answer={
                          previewAnswers[previewKey(item)] ??
                          defaultAnswer(item)
                        }
                        preferencePrefix={`preview:${scope}`}
                        preview
                        onChange={(answer: ItemAnswer) =>
                          setPreviewAnswers((current) => ({
                            ...current,
                            [previewKey(item)]: answer,
                          }))
                        }
                        taskContent={
                          <p className="editor-muted">
                            Tasks from{" "}
                            {draft.lists.find((list) => list.id === item.listId)
                              ?.title ?? "your list"}{" "}
                            appear here.
                          </p>
                        }
                      />
                    ))}
                  </ChecklistBlock>
                );
              })}
            {!previewBlocks.some(
              (value) =>
                (previewWhole ||
                  value.id === (previewItem?.blockId ?? block?.id)) &&
                effectiveDraft.items.some(
                  (item) =>
                    !item.deleted &&
                    item.blockId === value.id &&
                    (previewWhole ||
                      !previewItem ||
                      item.id === previewItem.id) &&
                    scheduleMatches(item.schedule, previewDate),
                ),
            ) && (
              <p className="editor-empty">
                Nothing is scheduled for this date.
              </p>
            )}
          </section>
        )}
        {screen === "review" && (
          <section aria-label="Checklist change review">
            <p className="editor-summary">
              Today:{" "}
              <strong>
                {beforeProgress.completed}/{beforeProgress.total}
              </strong>
              <ArrowRight size={16} />
              <strong>
                {afterProgress.completed}/{afterProgress.total} checks
              </strong>{" "}
              if applied today.
            </p>
            {changed.length ? (
              <ul className="editor-change-list">
                {changed.map((change) => (
                  <li key={change.id}>
                    <span className="editor-chip">{change.action}</span>
                    <span>
                      {change.title}
                      {change.reset && (
                        <small>
                          New answer starts blank. Earlier answers are retained.
                        </small>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="editor-empty">No checklist changes.</p>
            )}
            <p className="editor-muted">
              Earlier days keep their original checklist. The next day begins at
              2 AM.
            </p>
          </section>
        )}
      </EditorWorkspace>
      {pendingNavigation && (
        <Modal
          title="Unfinished item"
          role="alertdialog"
          onClose={() => setPendingNavigation(null)}
        >
          <p>Keep these changes in your checklist draft?</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setPendingNavigation(null)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                discardForm();
                const action = pendingNavigation;
                setPendingNavigation(null);
                action();
              }}
            >
              Discard item edits
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (!finishForm()) {
                  setPendingNavigation(null);
                  return;
                }
                const action = pendingNavigation;
                setPendingNavigation(null);
                action();
              }}
            >
              Save to draft
            </button>
          </div>
        </Modal>
      )}
      {move && (
        <Modal title="Move item" onClose={() => setMove(null)}>
          <Field label="Destination block">
            <select
              value={move.destination}
              onChange={(event) =>
                setMove({ ...move, destination: event.target.value })
              }
            >
              {blocks
                .filter((value) => value.id !== move.item.blockId)
                .map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.title}
                  </option>
                ))}
            </select>
          </Field>
          <div className="dialog-actions">
            <button type="button" onClick={() => setMove(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const destination = move.destination;
                setDraft((current) => ({
                  ...current,
                  items: current.items.map((item) =>
                    item.id === move.item.id
                      ? {
                          ...item,
                          blockId: destination,
                          order:
                            Math.max(
                              -1,
                              ...current.items
                                .filter(
                                  (value) =>
                                    value.blockId === destination &&
                                    !value.deleted,
                                )
                                .map((value) => value.order),
                            ) + 1,
                        }
                      : item,
                  ),
                }));
                setSelection(destination);
                setMove(null);
              }}
            >
              Move item
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PreviousAnswerView({
  item,
  answer,
}: {
  item: ChecklistItem;
  answer: ItemAnswer;
}) {
  return (
    <div className="customization-readonly-answers">
      <ChecklistItemInput
        item={item}
        answer={answer}
        locked
        onChange={() => {}}
        preferencePrefix="previous-answer"
      />
      {answer.selections.length > 0 && (
        <ul>
          {answer.selections.map((selection) => (
            <li key={selection.taskId}>
              {selection.title}
              {selection.children.length
                ? `: ${selection.children.map((child) => child.title).join(", ")}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
