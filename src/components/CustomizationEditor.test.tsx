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
import { ChecklistItemInput } from "./ChecklistItemInput";
import { CustomizationEditor, ManageTodoLists } from "./CustomizationEditor";

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

it("previews answers without saving records and publishes a changed checklist tomorrow", async () => {
  const configuration = template(),
    save = vi.fn(),
    close = vi.fn();
  const user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={configuration}
      today={today}
      baseRevision={7}
      onSave={save}
      onClose={close}
    />,
  );
  const general = screen.getByRole("region", { name: "Edit General" });
  fireEvent.change(
    within(general).getByRole("textbox", { name: "Block title" }),
    {
      target: { value: "My routine" },
    },
  );
  const preview = screen.getByRole("complementary", {
    name: "Checklist live preview",
  });
  fireEvent.change(within(preview).getByLabelText("Preview date"), {
    target: { value: "2026-10-17" },
  });
  expect(within(preview).queryByText("Attended class")).toBeNull();
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(screen.getByRole("button", { name: "Start next day" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      blocks: expect.arrayContaining([
        expect.objectContaining({ id: "general", title: "My routine" }),
      ]),
    }),
    "2026-10-16",
    7,
  );
  expect(close).toHaveBeenCalledOnce();
  expect(configuration.blocks[0].title).toBe("General");
});

it("keeps the draft and editor open when a save conflicts", async () => {
  const save = vi
    .fn()
    .mockRejectedValue(
      new Error(
        "Another device changed this checklist. Your draft was retained.",
      ),
    );
  const close = vi.fn(),
    draft = vi.fn();
  const user = userEvent.setup();
  render(
    <CustomizationEditor
      configuration={template()}
      today={today}
      baseRevision={3}
      onSave={save}
      onDraftChange={draft}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add block" }));
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(screen.getByRole("button", { name: "Apply today" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your draft was retained",
  );
  expect(screen.getByRole("region", { name: "Edit New block" })).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  expect(draft).toHaveBeenLastCalledWith(
    expect.objectContaining({
      blocks: expect.arrayContaining([
        expect.objectContaining({ title: "New block" }),
      ]),
    }),
  );
});

it("creates lists immediately but gives linked daily questions a date choice", async () => {
  const configuration = template(),
    lists = vi.fn(),
    connection = vi.fn();
  const user = userEvent.setup();
  const view = (value: Configuration) => (
    <ManageTodoLists
      configuration={value}
      today={today}
      baseRevision={4}
      onSaveLists={lists}
      onSaveConnection={connection}
      onClose={vi.fn()}
    />
  );
  const rendered = render(view(configuration));
  await user.click(screen.getByRole("button", { name: "Add To-do list" }));
  await user.type(
    screen.getByRole("textbox", { name: "List title" }),
    "Fitness",
  );
  await user.click(screen.getByRole("button", { name: "Save list" }));
  const saved = lists.mock.calls[0][0];
  expect(saved).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: "Fitness" })]),
  );
  rendered.rerender(view({ ...configuration, lists: saved }));
  const fitness = screen.getByText("Fitness").closest("section")!;
  await user.click(
    within(fitness).getByRole("button", { name: "Connect to daily checklist" }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Question visibility" }),
    "always",
  );
  await user.click(screen.getByRole("button", { name: "Start next day" }));
  expect(connection).toHaveBeenCalledWith(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          label: "Worked on Fitness tasks?",
          visibility: "always",
        }),
      ]),
    }),
    "2026-10-16",
    4,
  );
});
