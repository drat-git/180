import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, it, vi } from "vitest";
import { defaultConfiguration } from "../lib/customization";
import {
  rebaseEditorRecovery,
  type EditorRecoveryState,
} from "../lib/editorRecovery";
import {
  ManageTodoLists,
  type ManageTodoListsProps,
} from "./TodoListWorkspace";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const today = "2026-10-15";
function props(
  overrides: Partial<ManageTodoListsProps> = {},
): ManageTodoListsProps {
  return {
    configuration: defaultConfiguration("local-demo:list-editor", today),
    today,
    baseRevision: 4,
    onSaveLists: vi.fn(),
    onSaveConnection: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

it("edits one compact list at a time and saves its stable identity immediately", async () => {
  const user = userEvent.setup(),
    options = props();
  render(<ManageTodoLists {...options} />);
  expect(screen.queryByRole("textbox", { name: "List title" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Edit School" }));
  const title = screen.getByRole("textbox", { name: "List title" });
  fireEvent.change(title, { target: { value: "Study" } });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "List icon" }),
    "book",
  );
  await user.click(screen.getByRole("button", { name: "Save list" }));
  await waitFor(() => expect(options.onSaveLists).toHaveBeenCalledOnce());
  expect(options.onSaveLists).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "school", title: "Study", icon: "book" }),
    ]),
    4,
  );
  expect(options.onSaveConnection).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Edit Study" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "List title" })).toBeNull();
});

it("previews an unfinished question without saving, then reviews its separately dated change", async () => {
  const user = userEvent.setup(),
    options = props();
  render(<ManageTodoLists {...options} />);
  const row = screen.getByRole("region", { name: "Life list" });
  await user.click(within(row).getByLabelText("Actions for Life"));
  await user.click(
    within(row).getByRole("button", { name: "Connect to daily checklist" }),
  );
  expect(screen.queryByRole("combobox", { name: "Answer type" })).toBeNull();
  expect(
    screen.queryByRole("combobox", { name: "Connected To-do list" }),
  ).toBeNull();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Question visibility" }),
    "always",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Made time for life tasks?" },
  });
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByText("1 / 1 check")).toBeVisible();
  expect(options.onSaveConnection).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Back to question" }));
  expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Made time for life tasks?",
  );
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(options.onSaveConnection).not.toHaveBeenCalled();
  expect(
    screen.getByRole("region", { name: "Review daily question" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Start next day" }));
  expect(options.onSaveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "tasks",
          listId: "life",
          label: "Made time for life tasks?",
          visibility: "always",
        }),
      ]),
    }),
    "2026-10-16",
    4,
  );
});

it("retains multiple unfinished forms locally, restores them after reload, and cancels without publishing", async () => {
  const user = userEvent.setup(),
    options = props();
  let recovery: EditorRecoveryState | null = null;
  const onRecoveryChange = vi.fn((value: EditorRecoveryState | null) => {
    recovery = value;
  });
  const view = render(
    <ManageTodoLists {...options} onRecoveryChange={onRecoveryChange} />,
  );
  await user.click(screen.getByRole("button", { name: "Add To-do list" }));
  fireEvent.change(screen.getByRole("textbox", { name: "List title" }), {
    target: { value: "Fitness" },
  });
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "List title" })).toHaveValue(
    "Fitness",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Save to draft" }));
  expect(screen.queryByRole("button", { name: "Edit Fitness" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "Unfinished list edits" }),
  ).toHaveTextContent("Fitness");
  await user.click(screen.getByRole("button", { name: "Edit School" }));
  fireEvent.change(screen.getByRole("textbox", { name: "List title" }), {
    target: { value: "Study" },
  });
  await user.click(screen.getByRole("button", { name: "Close editor" }));
  await user.click(screen.getByRole("button", { name: "Save to draft" }));
  expect(options.onClose).toHaveBeenCalledOnce();
  expect(options.onSaveLists).not.toHaveBeenCalled();
  expect(recovery!.drafts).toHaveLength(2);
  view.unmount();
  render(
    <ManageTodoLists
      {...options}
      recovery={recovery!}
      onRecoveryChange={onRecoveryChange}
    />,
  );
  const cached = screen.getByRole("region", { name: "Unfinished list edits" });
  await user.click(
    within(cached).getAllByRole("button", { name: "Continue editing" })[0],
  );
  expect(screen.getByRole("textbox", { name: "List title" })).toHaveValue(
    "Fitness",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getByRole("region", { name: "Unfinished list edits" }),
  ).not.toHaveTextContent("Fitness");
  expect(options.onSaveLists).not.toHaveBeenCalled();
});

it("keeps a conflicting list form and publishes archive and restore as retained identities", async () => {
  const user = userEvent.setup(),
    save = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Another device changed these lists. Your draft is retained.",
        ),
      )
      .mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const options = props({ onSaveLists: save });
  render(<ManageTodoLists {...options} />);
  await user.click(screen.getByRole("button", { name: "Edit Life" }));
  fireEvent.change(screen.getByRole("textbox", { name: "List title" }), {
    target: { value: "Personal" },
  });
  await user.click(screen.getByRole("button", { name: "Save list" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Another device");
  expect(screen.getByRole("textbox", { name: "List title" })).toHaveValue(
    "Personal",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  const row = screen.getByRole("region", { name: "Life list" });
  await user.click(within(row).getByLabelText("Actions for Life"));
  await user.click(within(row).getByRole("button", { name: "Archive list" }));
  expect(save).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "life", title: "Life", deleted: true }),
    ]),
    4,
  );
  await user.click(screen.getByText("Archived lists (1)"));
  await user.click(screen.getByRole("button", { name: "Restore Life" }));
  expect(save).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "life", deleted: false }),
    ]),
    4,
  );
  expect(options.onSaveConnection).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it("merges a recovered list title with newer icon settings instead of restoring its old snapshot", async () => {
  const user = userEvent.setup();
  const options = props();
  const before = options.configuration.lists.find(
    (list) => list.id === "school",
  )!;
  const configuration = {
    ...options.configuration,
    lists: options.configuration.lists.map((list) =>
      list.id === before.id ? { ...list, icon: "leaf" } : list,
    ),
  };
  const recovery = rebaseEditorRecovery(
    {
      section: "lists",
      baseRevision: 3,
      form: {
        kind: "list",
        before,
        value: { ...before, title: "Study" },
        isNew: false,
      },
    },
    configuration,
    4,
  );
  render(
    <ManageTodoLists
      {...options}
      configuration={configuration}
      recovery={recovery}
    />,
  );
  expect(screen.getByRole("combobox", { name: "List icon" })).toHaveValue(
    "leaf",
  );
  await user.click(screen.getByRole("button", { name: "Save list" }));
  expect(options.onSaveLists).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "school", title: "Study", icon: "leaf" }),
    ]),
    4,
  );
});

it.each([true, false])(
  "requires an explicit choice for a recovered conflicting list edit (keep local: %s)",
  async (keepLocal) => {
    const user = userEvent.setup();
    const options = props();
    const before = options.configuration.lists.find(
      (list) => list.id === "school",
    )!;
    const configuration = {
      ...options.configuration,
      lists: options.configuration.lists.map((list) =>
        list.id === before.id
          ? { ...list, title: "Classes", icon: "leaf" }
          : list,
      ),
    };
    const recovery = rebaseEditorRecovery(
      {
        section: "lists",
        baseRevision: 3,
        form: {
          kind: "list",
          before,
          value: { ...before, title: "Study" },
          isNew: false,
        },
      },
      configuration,
      4,
    );
    render(
      <ManageTodoLists
        {...options}
        configuration={configuration}
        recovery={recovery}
      />,
    );
    expect(
      screen.getByRole("alert", { name: "Review recovered edit" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save list" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: keepLocal ? "Keep my changes" : "Use latest settings",
      }),
    );
    expect(screen.getByRole("button", { name: "Save list" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(options.onSaveLists).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "school",
          title: keepLocal ? "Study" : "Classes",
          icon: "leaf",
        }),
      ]),
      4,
    );
  },
);

it("does not revive an archived list from an unfinished recovered form", async () => {
  const user = userEvent.setup();
  const options = props();
  const before = options.configuration.lists.find(
    (list) => list.id === "school",
  )!;
  const configuration = {
    ...options.configuration,
    lists: options.configuration.lists.map((list) =>
      list.id === before.id ? { ...list, deleted: true } : list,
    ),
  };
  const recovery = rebaseEditorRecovery(
    {
      section: "lists",
      baseRevision: 3,
      form: {
        kind: "list",
        before,
        value: { ...before, title: "Study" },
        isNew: false,
      },
    },
    configuration,
    4,
  );
  render(
    <ManageTodoLists
      {...options}
      configuration={configuration}
      recovery={recovery}
    />,
  );
  expect(
    screen.getByRole("alert", { name: "Review recovered edit" }),
  ).toHaveTextContent("no longer active");
  expect(screen.queryByRole("button", { name: "Save list" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Keep my changes" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Archived lists (1)")).toBeVisible();
  expect(options.onSaveLists).not.toHaveBeenCalled();
});

it("preserves newer daily question rules while publishing a recovered visibility edit", async () => {
  const user = userEvent.setup();
  const options = props();
  const before = options.configuration.items.find(
    (item) => item.id === "schoolTasks",
  )!;
  const completion = { op: "equals" as const, field: "value", value: false };
  const configuration = {
    ...options.configuration,
    items: options.configuration.items.map((item) =>
      item.id === before.id
        ? { ...item, helper: "Latest instructions", completion }
        : item,
    ),
  };
  const recovery = rebaseEditorRecovery(
    {
      section: "lists",
      baseRevision: 3,
      form: {
        kind: "connection",
        before,
        value: { ...before, visibility: "always" },
        isNew: false,
      },
    },
    configuration,
    4,
  );
  render(
    <ManageTodoLists
      {...options}
      configuration={configuration}
      recovery={recovery}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Apply today" }));
  expect(options.onSaveConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "schoolTasks",
          visibility: "always",
          helper: "Latest instructions",
          completion,
        }),
      ]),
    }),
    today,
    4,
  );
});
