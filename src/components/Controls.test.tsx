import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import { BinaryAnswer, Reason, ChecklistBlock } from "./Controls";
import { DisplayPreferencesProvider } from "../lib/displayPreferences";
it("exposes mutually exclusive answer buttons accessibly", async () => {
  const change = vi.fn();
  const { rerender } = render(
    <BinaryAnswer label="Meal 1" value={null} onChange={change} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(change).toHaveBeenCalledWith(true);
  rerender(<BinaryAnswer label="Meal 1" value={true} onChange={change} />);
  expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "No" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
it("remembers minimized controls after remount and isolates each account", async () => {
  const view = (userId: string) => (
    <DisplayPreferencesProvider userId={userId}>
      <ChecklistBlock title="Food">
        <span>Food fields</span>
      </ChecklistBlock>
      <Reason
        label="Meal 1"
        value="Saved context"
        onChange={() => {}}
        locked={false}
        onAttempt={() => {}}
      />
    </DisplayPreferencesProvider>
  );
  let rendered = render(view("owner"));
  await userEvent.click(screen.getByRole("button", { name: "Minimize" }));
  await userEvent.click(screen.getByRole("button", { name: "Minimize Food" }));
  rendered.unmount();
  rendered = render(view("another-account"));
  expect(screen.getByText("Food fields")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Saved context");
  rendered.unmount();
  render(view("owner"));
  expect(screen.getByText("Food fields")).not.toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Maximize Food" }));
  await userEvent.click(screen.getByRole("button", { name: "View reason" }));
  expect(screen.getByText("Food fields")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Saved context");
});
it("opens saved reasons and minimizes without changing text", async () => {
  const change = vi.fn();
  const { unmount } = render(
    <Reason
      label="Meal 1"
      value="No groceries"
      onChange={change}
      locked={false}
      onAttempt={() => {}}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveValue("No groceries");
  await userEvent.click(screen.getByRole("button", { name: "Minimize" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "View reason" }));
  expect(screen.getByRole("textbox")).toHaveValue("No groceries");
  expect(change).not.toHaveBeenCalled();
  unmount();
  render(
    <Reason
      label="Meal 1"
      value="No groceries"
      onChange={change}
      locked={false}
      onAttempt={() => {}}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveValue("No groceries");
});
