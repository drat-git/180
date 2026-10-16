import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, it, vi } from "vitest";
import { defaultAnswer, defaultConfiguration } from "../lib/customization";
import type {
  ChecklistItem,
  Configuration,
  ItemAnswer,
} from "../lib/customizationTypes";
import type { EditorRecoveryState } from "../lib/editorRecovery";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { CustomizationEditor } from "./CustomizationEditor";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

const today = "2026-10-15";
const template = () => defaultConfiguration("local-demo:editor", today);
function InputHarness({
  item,
  initial = defaultAnswer(item),
}: {
  item: ChecklistItem;
  initial?: ItemAnswer;
}) {
  const [answer, setAnswer] = useState(initial);
  return (
    <>
      <ChecklistItemInput item={item} answer={answer} onChange={setAnswer} />
      <output aria-label="Saved example answer">
        {JSON.stringify(answer)}
      </output>
    </>
  );
}

it("retains hidden counter and occurrence notes while allowing the main answer to clear", async () => {
  const item = template().items.find((value) => value.id === "cannabis")!;
  const user = userEvent.setup();
  render(<InputHarness item={item} />);
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(
    screen.getByRole("button", { name: "Increase how many times?" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Vaping use 2 description" }),
    "After dinner",
  );
  await user.click(screen.getByRole("button", { name: "No" }));
  expect(screen.queryByRole("status", { name: "How many times?" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "No" }));
  expect(
    JSON.parse(screen.getByLabelText("Saved example answer").textContent!)
      .value,
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Yes" }));
  expect(
    screen.getByRole("status", { name: "How many times?" }),
  ).toHaveTextContent("2");
  expect(
    screen.getByRole("textbox", { name: "Vaping use 2 description" }),
  ).toHaveValue("After dinner");
});

it("requires a fresh follow-up choice after clearing a successful compound answer", async () => {
  const item = template().items.find((value) => value.id === "amBreakfast")!;
  const user = userEvent.setup();
  render(<InputHarness item={item} />);
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("radio", { name: "Smoothie" }));
  expect(screen.getByText("Smoothie")).toBeVisible();
  expect(screen.queryByRole("radio")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByRole("radio", { name: "Smoothie" })).not.toBeChecked();
  expect(
    JSON.parse(screen.getByLabelText("Saved example answer").textContent!)
      .fields.choice,
  ).toBeNull();
});

it("defers the intended protected answer until unlocking instead of losing the click", async () => {
  const item = template().items.find((value) => value.id === "cannabis")!;
  const onChange = vi.fn();
  let unlock: (() => void) | undefined;
  render(
    <ChecklistItemInput
      item={item}
      answer={defaultAnswer(item)}
      onChange={onChange}
      locked
      onAttempt={(action) => {
        unlock = action;
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(unlock).toBeTypeOf("function");
  unlock?.();
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      value: true,
      fields: expect.objectContaining({ count: 1 }),
    }),
  );
});

it("keeps new blocks and items in working forms until Done and drops canceled items", async () => {
  const user = userEvent.setup(),
    draft = vi.fn();
  render(
    <CustomizationEditor
      configuration={template()}
      today={today}
      baseRevision={7}
      onDraftChange={draft}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getAllByRole("button", { name: "Add block" })[0]);
  fireEvent.change(screen.getByRole("textbox", { name: "Block name" }), {
    target: { value: "Reading" },
  });
  expect(
    draft.mock.lastCall?.[0].blocks.some(
      (block: { title: string }) => block.title === "Reading",
    ),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Open Reading" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await user.click(screen.getByRole("button", { name: /^Number \/ counter/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Pages read" },
  });
  expect(
    draft.mock.lastCall?.[0].items.some(
      (item: ChecklistItem) => item.label === "Pages read",
    ),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Edit Pages read" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await user.click(screen.getByRole("button", { name: /^Number \/ counter/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Pages read" },
  });
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(
    screen.getByRole("button", { name: "Edit Pages read" }),
  ).toBeInTheDocument();
  expect(draft.mock.lastCall?.[0].items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Pages read", kind: "number" }),
    ]),
  );
});

it("previews unfinished item wording and example answers on demand before publishing tomorrow", async () => {
  const configuration = template(),
    save = vi.fn(),
    close = vi.fn(),
    user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={configuration}
      today={today}
      baseRevision={7}
      onSave={save}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open General" }));
  await user.click(screen.getByRole("button", { name: "Edit Wake-up time" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Morning wake-up" },
  });
  expect(
    screen.queryByRole("region", { name: "Checklist preview" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  const preview = screen.getByRole("region", { name: "Checklist preview" });
  expect(within(preview).getByText("Morning wake-up")).toBeVisible();
  fireEvent.change(within(preview).getByLabelText("Morning wake-up"), {
    target: { value: "09:30" },
  });
  fireEvent.change(within(preview).getByLabelText("Preview date"), {
    target: { value: "2026-10-17" },
  });
  expect(save).not.toHaveBeenCalled();
  await user.selectOptions(
    within(preview).getByRole("combobox", { name: "Preview scope" }),
    "whole",
  );
  expect(within(preview).queryByText("Attended class")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Back to editor" }));
  expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Morning wake-up",
  );
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(screen.getByRole("button", { name: "Start next day" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "wake", label: "Morning wake-up" }),
      ]),
    }),
    "2026-10-16",
    7,
  );
  expect(close).toHaveBeenCalledOnce();
  expect(configuration.items.find((item) => item.id === "wake")?.label).toBe(
    "Wake-up time",
  );
});

it("round-trips an existing compound item and retains the draft when publishing conflicts", async () => {
  const configuration = template(),
    item = configuration.items.find((entry) => entry.id === "cannabis")!;
  item.completion = {
    op: "any",
    rules: [
      { op: "equals", field: "value", value: false },
      {
        op: "all",
        rules: [
          { op: "equals", field: "value", value: true },
          { op: "compare", field: "count", operator: "lte", value: 2 },
        ],
      },
    ],
  };
  const save = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Another device changed this checklist. Your draft was retained.",
        ),
      ),
    close = vi.fn(),
    draft = vi.fn(),
    user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={configuration}
      today={today}
      baseRevision={3}
      onSave={save}
      onDraftChange={draft}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open General" }));
  await user.click(screen.getByRole("button", { name: `Edit ${item.label}` }));
  expect(
    screen.getByRole("button", { name: "Edit custom conditions" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(draft.mock.lastCall?.[0]).toEqual(configuration);
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(screen.getByRole("button", { name: "Apply today" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your draft was retained",
  );
  expect(close).not.toHaveBeenCalled();
  expect(
    save.mock.calls[0][0].items.find(
      (entry: ChecklistItem) => entry.id === item.id,
    ),
  ).toEqual(item);
});

it("saves an unfinished item to the draft and clears its recovery form before closing", async () => {
  const calls: string[] = [],
    draft = vi.fn((_configuration: Configuration) => {
      calls.push("draft");
    }),
    recovery = vi.fn((_state: EditorRecoveryState | null) => {
      calls.push("recovery");
    }),
    close = vi.fn(() => calls.push("close")),
    user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={template()}
      today={today}
      baseRevision={4}
      onDraftChange={draft}
      onRecoveryChange={recovery}
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open General" }));
  await user.click(screen.getByRole("button", { name: "Edit Wake-up time" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Earlier mornings" },
  });
  expect(recovery.mock.lastCall?.[0]).toMatchObject({
    form: { value: { label: "Earlier mornings" } },
  });
  await user.click(screen.getByRole("button", { name: "Close editor" }));
  const prompt = screen.getByRole("alertdialog", { name: "Unfinished item" });
  calls.length = 0;
  await user.click(
    within(prompt).getByRole("button", { name: "Save to draft" }),
  );
  expect(draft.mock.lastCall?.[0].items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "wake", label: "Earlier mornings" }),
    ]),
  );
  expect(calls.indexOf("draft")).toBeLessThan(calls.indexOf("close"));
  const closeOrder = close.mock.invocationCallOrder[0];
  const savedDraftOrder = [...draft.mock.invocationCallOrder]
    .reverse()
    .find((order) => order < closeOrder)!;
  const beforeClose = recovery.mock.invocationCallOrder.findIndex(
    (order) => order > savedDraftOrder && order < closeOrder,
  );
  expect(beforeClose).toBeGreaterThanOrEqual(0);
  expect(recovery.mock.calls[beforeClose][0]).toMatchObject({
    level: "overview",
  });
  expect(recovery.mock.calls[beforeClose][0]?.form).toBeUndefined();
  expect(close).toHaveBeenCalledOnce();
});

it("discards an unfinished edit without retaining its working form or changing the draft", async () => {
  const configuration = template(),
    draft = vi.fn(),
    recovery = vi.fn(),
    close = vi.fn(),
    user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={configuration}
      today={today}
      baseRevision={4}
      onDraftChange={draft}
      onRecoveryChange={recovery}
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open General" }));
  await user.click(screen.getByRole("button", { name: "Edit Wake-up time" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Discard this wording" },
  });
  await user.click(screen.getByRole("button", { name: "Close editor" }));
  await user.click(screen.getByRole("button", { name: "Discard item edits" }));
  expect(draft.mock.lastCall?.[0]).toEqual(configuration);
  expect(recovery.mock.lastCall?.[0]?.form).toBeUndefined();
  expect(close).toHaveBeenCalledOnce();
});
