import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultConfiguration } from "../lib/customization";
import { editorItem } from "../lib/editorPresentation";
import type { ChecklistItem, ItemKind } from "../lib/customizationTypes";
import { ChecklistItemEditor } from "./ChecklistItemEditor";

function Harness({ initial }: { initial: ChecklistItem }) {
  const [item, setItem] = useState(initial);
  return (
    <>
      <ChecklistItemEditor
        item={item}
        original={initial}
        blocks={[]}
        lists={[]}
        onChange={setItem}
      />
      <output aria-label="Working item">{JSON.stringify(item)}</output>
    </>
  );
}
const current = () =>
  JSON.parse(
    screen.getByLabelText("Working item").textContent!,
  ) as ChecklistItem;
const demo = () =>
  defaultConfiguration("local-demo:focused-editor", "2026-10-15");

it("keeps existing compound completion rules unchanged while changing wording", () => {
  const item = demo().items.find((entry) => entry.id === "cannabis")!;
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
  const original = structuredClone(item);
  const change = vi.fn();
  const { rerender } = render(
    <ChecklistItemEditor
      item={item}
      blocks={[]}
      lists={[]}
      onChange={change}
    />,
  );
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Edit custom conditions" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "New wording" },
  });
  const next = change.mock.calls[0][0] as ChecklistItem;
  expect(next.completion).toEqual(original.completion);
  expect(next.followups).toEqual(original.followups);
  rerender(
    <ChecklistItemEditor
      item={next}
      blocks={[]}
      lists={[]}
      onChange={change}
    />,
  );
  expect(next.generation).toBe(original.generation);
});

it("edits a reversed completion goal without changing the answer type", () => {
  const item = editorItem("boolean", "general", 0);
  render(<Harness initial={item} />);
  fireEvent.change(screen.getByLabelText("Earn a check when"), {
    target: { value: "false" },
  });
  expect(current().completion).toEqual({
    op: "equals",
    field: "value",
    value: false,
  });
  expect(current().kind).toBe("boolean");
});

it("uses inclusive ranges and keeps allowed input limits separate", () => {
  const item = { ...editorItem("number", "general", 0), min: 0, max: 100 };
  render(<Harness initial={item} />);
  fireEvent.change(screen.getByLabelText("Earn a check when"), {
    target: { value: "between" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum goal" }), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum goal" }), {
    target: { value: "8" },
  });
  expect(current().completion).toEqual({
    op: "all",
    rules: [
      { op: "compare", field: "value", operator: "gte", value: 3 },
      { op: "compare", field: "value", operator: "lte", value: 8 },
    ],
  });
  expect(current()).toMatchObject({ min: 0, max: 100 });
});

it("edits time spent in hours and minutes while preserving minute storage", () => {
  render(
    <Harness
      initial={{
        ...editorItem("duration", "general", 0),
        completion: {
          op: "compare",
          field: "value",
          operator: "lte",
          value: 210,
        },
      }}
    />,
  );
  expect(screen.getByLabelText("Goal hours")).toHaveValue(3);
  expect(screen.getByLabelText("Goal minutes")).toHaveValue(30);
  fireEvent.change(screen.getByLabelText("Goal hours"), {
    target: { value: "2" },
  });
  expect(current().completion).toMatchObject({ value: 150, operator: "lte" });
});

describe.each<ItemKind>([
  "boolean",
  "checkbox",
  "tasks",
  "number",
  "time",
  "duration",
  "text",
  "choice",
])("new extra question on %s", (kind) => {
  it("uses a meaningful default visibility and expands only the active extra question", async () => {
    const user = userEvent.setup();
    render(<Harness initial={editorItem(kind, "general", 0)} />);
    await user.click(screen.getByText("Advanced", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(current().followups[0].condition).toEqual(
      ["boolean", "checkbox", "tasks"].includes(kind)
        ? { op: "equals", field: "value", value: true }
        : { op: "always" },
    );
    await user.click(screen.getByRole("button", { name: "Add counter" }));
    expect(
      screen.getAllByRole("textbox", { name: "Extra question" }),
    ).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Extra question" })).toHaveValue(
      "How many times?",
    );
    expect(current().followups).toHaveLength(2);
  });
});

it("uses question wording in condition controls and supports notes for each count", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      initial={{
        ...editorItem("number", "general", 0),
        label: "Glasses of water",
      }}
    />,
  );
  await user.click(screen.getByText("Advanced", { selector: "summary" }));
  await user.click(
    screen.getByRole("button", { name: "Add notes for each count" }),
  );
  expect(
    screen.getByRole("combobox", { name: "Count to use" }),
  ).toHaveTextContent("Glasses of water");
  fireEvent.change(screen.getByLabelText("Show when"), {
    target: { value: "compare" },
  });
  expect(
    screen.getAllByRole("combobox", { name: "Question to check" })[0],
  ).toHaveTextContent("Glasses of water");
  expect(current().followups[0]).toMatchObject({
    kind: "occurrences",
    countField: "value",
  });
});

it("offers no plain checkbox type and edits an existing checkbox definition with Yes/No controls", () => {
  const item = {
    ...editorItem("checkbox", "general", 0),
    label: "Moved my body",
  };
  const change = vi.fn();
  render(
    <ChecklistItemEditor
      item={item}
      blocks={[]}
      lists={[]}
      onChange={change}
    />,
  );
  expect(
    screen.queryByRole("option", { name: "Checkbox" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Answer type" })).toHaveValue(
    "boolean",
  );
  expect(
    screen.getByRole("combobox", { name: "Earn a check when" }),
  ).toHaveValue("true");
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Moved today" },
  });
  expect(change).toHaveBeenLastCalledWith({ ...item, label: "Moved today" });
});
