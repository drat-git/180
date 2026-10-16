import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChecklistItemInput } from "./ChecklistItemInput";
import { emptyItemAnswer } from "../lib/customization";
import { editorItem } from "../lib/editorPresentation";

it("shows existing starter checkbox definitions as Yes/No without resetting their saved answer or generation", () => {
  const item = {
    ...editorItem("checkbox", "habits", 0),
    label: "Moved my body",
    generation: 3,
  };
  const saved = {
    ...emptyItemAnswer(item),
    value: true,
    fields: { note: "Kept note" },
  };
  const original = structuredClone({ item, saved });
  const change = vi.fn();
  const { rerender } = render(
    <ChecklistItemInput item={item} answer={saved} onChange={change} />,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(change).toHaveBeenLastCalledWith({ ...saved, value: false });
  rerender(
    <ChecklistItemInput
      item={item}
      answer={{ ...saved, value: false }}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(change).toHaveBeenLastCalledWith({ ...saved, value: null });
  expect({ item, saved }).toEqual(original);
});
