import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { editorItem } from "../lib/editorPresentation";
import type { ChecklistItem } from "../lib/customizationTypes";
import { ChecklistItemEditor } from "./ChecklistItemEditor";

const summary = () =>
  screen.getByRole("region", { name: "How this check works" });

function Harness({
  initial,
  fixedConnection = false,
}: {
  initial: ChecklistItem;
  fixedConnection?: boolean;
}) {
  const [item, setItem] = useState(initial);
  return (
    <ChecklistItemEditor
      item={item}
      blocks={[
        { id: "general", title: "General", icon: "sun", order: 0 },
        {
          id: "weekends",
          title: "Weekend",
          icon: "sun",
          order: 1,
          schedule: { weekdays: [0, 6] },
        },
      ]}
      lists={[{ id: "school", title: "School", icon: "book", order: 0 }]}
      onChange={setItem}
      fixedConnection={fixedConnection}
    />
  );
}

it("updates completion and extra-question wording from unfinished form edits", async () => {
  const user = userEvent.setup();
  render(<Harness initial={editorItem("boolean", "general", 0)} />);
  fireEvent.change(screen.getByLabelText("Earn a check when"), {
    target: { value: "false" },
  });
  expect(summary()).toHaveTextContent("You earn a check when you answer No.");
  await user.click(screen.getByText("Advanced", { selector: "summary" }));
  await user.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Extra question" }), {
    target: { value: "Why did this happen?" },
  });
  expect(summary()).toHaveTextContent(
    "If you answer Yes, we’ll ask “Why did this happen?”",
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Require an answer to earn the check",
    }),
  );
  expect(summary()).toHaveTextContent(
    "complete every required extra question that appears",
  );
  expect(summary()).toHaveTextContent("required when it appears");
  expect(summary()).not.toHaveAttribute("aria-live");
});

it("expands multiple extra questions with keyboard access and updates renamed choices", async () => {
  const user = userEvent.setup();
  const item = editorItem("boolean", "general", 0);
  item.followups = [
    {
      id: "choice",
      label: "Breakfast type",
      kind: "choice",
      required: true,
      options: [{ id: "meal", label: "Meal" }],
    },
    {
      id: "why",
      label: "Why?",
      kind: "note",
      condition: { op: "equals", field: "choice", value: "meal" },
    },
  ];
  const change = vi.fn();
  const props = { item, blocks: [], lists: [], onChange: change };
  const { rerender } = render(<ChecklistItemEditor {...props} />);
  expect(summary()).toHaveTextContent("2 extra questions");
  expect(summary()).toHaveTextContent("1 is required when shown");
  expect(within(summary()).queryByText(/we’ll ask “Why\?”/)).not.toBeVisible();
  const toggle = within(summary()).getByRole("button", {
    name: "Show details",
  });
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(
    within(summary()).getByRole("button", { name: "Hide details" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(summary()).toHaveTextContent(
    "If “Breakfast type” is “Meal”, we’ll ask “Why?”",
  );
  const updated = structuredClone(item);
  updated.followups[0].options![0].label = "Cooked breakfast";
  rerender(<ChecklistItemEditor {...props} item={updated} />);
  expect(summary()).toHaveTextContent("“Cooked breakfast”");
  expect(change).not.toHaveBeenCalled();
  rerender(
    <ChecklistItemEditor
      {...props}
      item={{ ...updated, id: "another-item" }}
    />,
  );
  expect(
    within(summary()).getByRole("button", { name: "Show details" }),
  ).toHaveAttribute("aria-expanded", "false");
});

it("updates connected-list visibility and destination schedule in the same form", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      initial={{ ...editorItem("tasks", "general", 0), listId: "school" }}
      fixedConnection
    />,
  );
  expect(summary()).toHaveTextContent("record work on “School”");
  await user.click(
    within(summary()).getByRole("button", { name: "Show details" }),
  );
  expect(summary()).toHaveTextContent("unfinished tasks for that day");
  fireEvent.change(screen.getByLabelText("Question visibility"), {
    target: { value: "always" },
  });
  expect(summary()).toHaveTextContent("always appears on its scheduled days");
  fireEvent.change(screen.getByLabelText("Block", { exact: true }), {
    target: { value: "weekends" },
  });
  expect(summary()).toHaveTextContent("Block schedule for “Weekend”: Sun, Sat");
  expect(screen.queryByLabelText("Answer type")).not.toBeInTheDocument();
});
