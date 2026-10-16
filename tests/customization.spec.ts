import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

async function demo(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
}
async function settings(page: Page, kind: "checklist" | "lists") {
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("dialog", { name: "Your space", exact: true })
    .getByRole("button", {
      name: kind === "checklist" ? "Customize checklist" : "Manage To-do lists",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: kind === "checklist" ? "Customize checklist" : "Manage To-do lists",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function publish(
  editor: Locator,
  when: "Apply today" | "Start next day" = "Apply today",
) {
  await editor
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await editor.getByRole("button", { name: when, exact: true }).click();
  await expect(editor).not.toBeVisible();
}
async function newBlock(editor: Locator, title: string) {
  await editor
    .getByRole("button", { name: "Add block", exact: true })
    .first()
    .click();
  if (
    !(await editor
      .getByRole("textbox", { name: "Block name", exact: true })
      .isVisible())
  )
    await editor
      .getByRole("button", { name: "Edit block", exact: true })
      .click();
  await editor
    .getByRole("textbox", { name: "Block name", exact: true })
    .fill(title);
  await done(editor);
  return editor;
}
async function selectBlock(editor: Locator, title: string) {
  const button = editor
    .getByRole("navigation", { name: "Checklist blocks", exact: true })
    .getByRole("button", { name: `Open ${title}`, exact: true });
  if (!(await button.isVisible()))
    await editor.getByRole("button", { name: "Blocks", exact: true }).click();
  await button.click();
  await expect(
    editor.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function done(editor: Locator) {
  await editor.getByRole("button", { name: "Done", exact: true }).click();
}
async function advanced(editor: Locator) {
  const summary = editor.getByText("Advanced", { exact: true });
  if (!(await summary.evaluate((element) => element.closest("details")?.open)))
    await summary.click();
}
async function editItem(editor: Locator, block: string, label: string) {
  await selectBlock(editor, block);
  await editor
    .getByRole("button", { name: `Edit ${label}`, exact: true })
    .click();
  return editor;
}
async function actions(editor: Locator, label: string) {
  await editor.getByLabel(`${label} actions`, { exact: true }).click();
}
const inputNames: Record<string, string> = {
  boolean: "Yes / No",
  checkbox: "Checkbox",
  number: "Number / counter",
  time: "Time of day",
  duration: "Time spent",
  text: "Text",
  choice: "Choose one",
  tasks: "To-do list",
};
async function newQuestion(
  block: Locator,
  _blockTitle: string,
  label: string,
  kind = "boolean",
) {
  await block.getByRole("button", { name: "Add item", exact: true }).click();
  await block
    .getByRole("button", {
      name: new RegExp(
        `^${inputNames[kind].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
      ),
    })
    .click();
  await block
    .getByRole("textbox", { name: "Question", exact: true })
    .fill(label);
  return block;
}
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true });
async function task(page: Page, title: string) {
  const list = page.getByRole("region", { name: "Fitness", exact: true });
  await list
    .getByRole("textbox", { name: "New fitness task", exact: true })
    .fill(title);
  await list
    .getByRole("button", { name: "Add fitness task", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Add task options", exact: true })
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: `Complete ${title}`, exact: true }),
  ).toBeVisible();
}

test("custom blocks use scheduled typed inputs, conditional notes, independent preview and retained answer versions", async ({
  page,
}) => {
  await demo(page);
  let editor = await settings(page, "checklist");
  const block = await newBlock(editor, "Wellbeing");
  await block.getByRole("button", { name: "Edit block", exact: true }).click();
  await block
    .getByRole("combobox", { name: "Block icon", exact: true })
    .selectOption("leaf");
  await done(editor);
  const item = await newQuestion(
    block,
    "Wellbeing",
    "Glasses of water",
    "number",
  );
  await item.getByRole("spinbutton", { name: "Goal", exact: true }).fill("2");
  await advanced(item);
  await item
    .getByRole("textbox", {
      name: "Subtext (optional)",
      exact: true,
    })
    .fill("A glass is about 250 ml.");
  const weekdays = item.getByRole("group", { name: "Appears on", exact: true });
  for (const day of ["Sun", "Mon", "Wed", "Thu", "Fri", "Sat"])
    await weekdays.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await item.getByRole("button", { name: "Add note", exact: true }).click();
  const followup = item.locator(".editor-extra-form");
  await followup
    .getByRole("textbox", { name: "Extra question", exact: true })
    .fill("Extra context");
  await followup
    .getByRole("combobox", { name: "Show when", exact: true })
    .selectOption("compare");
  await followup
    .getByRole("combobox", { name: "Comparison", exact: true })
    .selectOption("gt");
  await followup
    .getByRole("spinbutton", { name: "Threshold", exact: true })
    .fill("4");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = editor.getByRole("region", {
    name: "Checklist preview",
    exact: true,
  });
  await preview
    .getByRole("spinbutton", { name: "Glasses of water", exact: true })
    .fill("6");
  await expect(
    preview.getByRole("textbox", {
      name: "Glasses of water Extra context",
      exact: true,
    }),
  ).toBeVisible();
  await preview.getByLabel("Preview date", { exact: true }).fill("2026-10-14");
  await expect(
    preview.getByRole("spinbutton", { name: "Glasses of water", exact: true }),
  ).not.toBeVisible();
  await editor
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();
  await done(editor);
  await publish(editor);
  const daily = page.getByRole("region", { name: "Wellbeing", exact: true });
  await expect(
    daily.getByText("A glass is about 250 ml.", { exact: true }),
  ).toBeVisible();
  const water = daily.getByRole("spinbutton", {
    name: "Glasses of water",
    exact: true,
  });
  await expect(water).toHaveValue("");
  await water.fill("6");
  await daily
    .getByRole("textbox", {
      name: "Glasses of water Extra context",
      exact: true,
    })
    .fill("After a long walk");
  await expect(
    daily.getByLabel("Wellbeing checklist progress", { exact: true }),
  ).toHaveText("1/1 complete");
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Glasses of water", exact: true }),
  ).toHaveValue("6");
  await nav(page, "Calendar").click();
  await expect(
    page.getByLabel("Calendar checklist progress", { exact: true }),
  ).toHaveText("1 of 16 checks complete");
  await nav(page, "Show daily checklist").click();

  editor = await settings(page, "checklist");
  const savedItem = await editItem(editor, "Wellbeing", "Glasses of water");
  await savedItem
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("text");
  await done(editor);
  await publish(editor);
  await expect(
    page.getByRole("textbox", { name: "Glasses of water", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Previous answer versions", exact: true })
    .click();
  const history = page.getByRole("dialog", {
    name: "Previous answer versions",
    exact: true,
  });
  const previousWater = history.getByRole("spinbutton", {
    name: "Glasses of water",
    exact: true,
  });
  await expect(previousWater).toHaveValue("6");
  await expect(previousWater).not.toBeEditable();
  await expect(
    history.getByRole("textbox", {
      name: "Glasses of water Extra context",
      exact: true,
    }),
  ).toHaveValue("After a long walk");
  await history
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.locator("body")).not.toHaveClass(/overflow/);
});

test("tomorrow additions survive unrelated changes applied today in the private app", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-15T12:00:00-04:00") });
  await openPrivateApp(page);
  let editor = await settings(page, "checklist");
  const block = await newBlock(editor, "Future routine");
  await newQuestion(block, "Future routine", "Practice piano");
  await done(editor);
  await publish(editor, "Start next day");
  await expect(
    page.getByRole("region", { name: "Future routine", exact: true }),
  ).not.toBeVisible();
  editor = await settings(page, "checklist");
  await selectBlock(editor, "General");
  await editor.getByRole("button", { name: "Edit block", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Block name", exact: true })
    .fill("Morning routine");
  await done(editor);
  await publish(editor);
  await expect(
    page.getByRole("region", { name: "Morning routine", exact: true }),
  ).toBeVisible();
  await page.clock.setSystemTime(new Date("2026-10-16T12:00:00-04:00"));
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Future routine", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Morning routine", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Practice piano", exact: true }),
  ).toBeVisible();
});

test("items can duplicate, move between blocks and reorder without reusing identities or oversized order values", async ({
  page,
}) => {
  await demo(page);
  const editor = await settings(page, "checklist");
  const block = await newBlock(editor, "Practice");
  let item = await newQuestion(block, "Practice", "Read", "checkbox");
  await done(editor);
  await actions(editor, "Read");
  await item.getByRole("button", { name: "Duplicate", exact: true }).click();
  await done(editor);
  await actions(editor, "Read copy");
  await editor
    .getByRole("button", { name: "Move to block", exact: true })
    .click();
  const moveDialog = page.getByRole("dialog", {
    name: "Move item",
    exact: true,
  });
  await moveDialog
    .getByRole("combobox", { name: "Destination block", exact: true })
    .selectOption("general");
  await moveDialog
    .getByRole("button", { name: "Move item", exact: true })
    .click();
  await selectBlock(editor, "Practice");
  item = await newQuestion(block, "Practice", "Write", "text");
  await done(editor);
  const itemHandle = item.getByRole("button", {
    name: "Reorder Write",
    exact: true,
  });
  await itemHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await block.getByRole("button", { name: "Edit block", exact: true }).click();
  await block
    .getByRole("textbox", { name: "Block name", exact: true })
    .fill("Creativity");
  await done(editor);
  const renamed = editor;
  const blockHandle = renamed.getByRole("button", {
    name: "Reorder Creativity",
    exact: true,
  });
  if (!(await blockHandle.isVisible()))
    await editor.getByRole("button", { name: "Blocks", exact: true }).click();
  await renamed
    .getByRole("button", { name: "Reorder Creativity", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await publish(editor);
  const creativity = page.getByRole("region", {
    name: "Creativity",
    exact: true,
  });
  await expect(creativity.locator(".field-label")).toHaveText([
    "Write",
    "Read",
  ]);
  const originalId = await creativity
    .getByRole("checkbox", { name: "Read", exact: true })
    .locator("..")
    .locator("..")
    .getAttribute("data-item-id");
  const copyId = await page
    .getByRole("checkbox", { name: "Read copy", exact: true })
    .locator("..")
    .locator("..")
    .getAttribute("data-item-id");
  expect(originalId).toBeTruthy();
  expect(copyId).toBeTruthy();
  expect(copyId).not.toBe(originalId);
  const orders = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("180-private");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const changes = await new Promise<
      { patch: { items?: { order?: number }[] } }[]
    >((resolve, reject) => {
      const request = database
        .transaction("configurations")
        .objectStore("configurations")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return changes
      .flatMap((change) => change.patch.items ?? [])
      .flatMap((item) => (typeof item.order === "number" ? [item.order] : []));
  });
  expect(orders.length).toBeGreaterThan(0);
  expect(orders.every((order) => order >= 0 && order < 1000000)).toBe(true);
});

test("custom lists connect always-visible daily questions and preserve manual work through completion undo", async ({
  page,
  context,
}) => {
  await demo(page);
  let manager = await settings(page, "lists");
  await manager
    .getByRole("button", { name: "Add To-do list", exact: true })
    .click();
  await manager
    .getByRole("textbox", { name: "List title", exact: true })
    .fill("Fitness");
  await manager
    .getByRole("combobox", { name: "List icon", exact: true })
    .selectOption("dumbbell");
  await manager.getByRole("button", { name: "Save list", exact: true }).click();
  const fitnessEditor = manager.getByRole("region", {
    name: "Fitness list",
    exact: true,
  });
  await fitnessEditor
    .getByLabel("Actions for Fitness", { exact: true })
    .click();
  await fitnessEditor
    .getByRole("button", { name: "Connect to daily checklist", exact: true })
    .click();
  await manager
    .getByRole("combobox", { name: "Question visibility", exact: true })
    .selectOption("always");
  await done(manager);
  await manager
    .getByRole("button", { name: "Apply today", exact: true })
    .click();
  await expect(manager).not.toBeVisible();
  await expect(
    page.getByRole("group", { name: "Worked on Fitness tasks?", exact: true }),
  ).toBeVisible();
  await nav(page, "To-do").click();
  await task(page, "Walk outside");
  await task(page, "Stretch");
  await nav(page, "Show daily checklist").click();
  await page
    .getByRole("group", { name: "Worked on Fitness tasks?", exact: true })
    .getByRole("button", { name: "Yes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose fitness tasks", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Fitness tasks worked on", exact: true })
    .getByRole("checkbox", { name: "Walk outside", exact: true })
    .check();
  await nav(page, "To-do").click();
  await page
    .getByRole("checkbox", { name: "Complete Walk outside", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Complete Walk outside", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Complete Stretch", exact: true })
    .check();
  await nav(page, "Show daily checklist").click();
  let question = page
    .getByRole("group", { name: "Worked on Fitness tasks?", exact: true })
    .locator("..")
    .locator("..");
  await expect(question.locator(".worked-on-list")).toContainText(
    "Walk outside",
  );
  await expect(question.locator(".worked-on-list")).toContainText("Stretch");
  await nav(page, "To-do").click();
  await page
    .getByRole("checkbox", { name: "Complete Stretch", exact: true })
    .uncheck();
  await nav(page, "Show daily checklist").click();
  question = page
    .getByRole("group", { name: "Worked on Fitness tasks?", exact: true })
    .locator("..")
    .locator("..");
  await expect(question.locator(".worked-on-list")).toContainText(
    "Walk outside",
  );
  await expect(question.locator(".worked-on-list")).not.toContainText(
    "Stretch",
  );
  manager = await settings(page, "lists");
  await manager
    .getByRole("region", { name: "Fitness list", exact: true })
    .getByLabel("Actions for Fitness", { exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await manager
    .getByRole("button", { name: "Archive list", exact: true })
    .click();
  await manager.getByText("Archived lists (1)", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await manager
    .getByRole("button", { name: "Restore Fitness", exact: true })
    .click();
  await expect(
    manager.getByRole("button", { name: "Edit Fitness", exact: true }),
  ).toBeVisible();
  await manager.getByRole("button", { name: "Done", exact: true }).click();
  await nav(page, "To-do").click();
  await expect(
    page.getByRole("checkbox", { name: "Complete Walk outside", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await nav(page, "To-do").click();
  await expect(
    page.getByRole("checkbox", { name: "Complete Walk outside", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await nav(page, "To-do").click();
  await expect(
    page.getByRole("region", { name: "Fitness", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "School", exact: true }),
  ).toBeVisible();
});

test("focused edits support cancel, unfinished navigation, reload recovery and preview without saving answers", async ({
  page,
}) => {
  await demo(page);
  let editor = await settings(page, "checklist");
  await newBlock(editor, "Focus");
  await newQuestion(editor, "Focus", "Cancelled attempt", "checkbox");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Edit Cancelled attempt", exact: true }),
  ).toHaveCount(0);

  await newQuestion(editor, "Focus", "Draft practice", "checkbox");
  await expect(
    editor.getByRole("textbox", { name: "Question", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("group", { name: "Appears on", exact: true }),
  ).not.toBeVisible();
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = editor.getByRole("region", {
    name: "Checklist preview",
    exact: true,
  });
  await preview
    .getByRole("checkbox", { name: "Draft practice", exact: true })
    .check();
  await editor
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();

  async function leaveForm() {
    const general = editor
      .getByRole("navigation", { name: "Checklist blocks", exact: true })
      .getByRole("button", { name: "Open General", exact: true });
    if (await general.isVisible()) await general.click();
    else
      await editor.getByRole("button", { name: "Focus", exact: true }).click();
    return page.getByRole("alertdialog", {
      name: "Unfinished item",
      exact: true,
    });
  }
  let unfinished = await leaveForm();
  await unfinished
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(
    editor.getByRole("textbox", { name: "Question", exact: true }),
  ).toHaveValue("Draft practice");
  await page.reload();
  editor = await settings(page, "checklist");
  await expect(editor.getByText(/^Recovered unfinished edit/)).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: "Question", exact: true }),
  ).toHaveValue("Draft practice");
  unfinished = await leaveForm();
  await unfinished
    .getByRole("button", { name: "Save to draft", exact: true })
    .click();
  await editItem(editor, "Focus", "Draft practice");
  await editor
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Discarded change");
  unfinished = await leaveForm();
  await unfinished
    .getByRole("button", { name: "Discard item edits", exact: true })
    .click();
  await selectBlock(editor, "Focus");
  await expect(
    editor.getByRole("button", { name: "Edit Draft practice", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Edit Discarded change", exact: true }),
  ).toHaveCount(0);
  await publish(editor);
  await expect(
    page.getByRole("checkbox", { name: "Draft practice", exact: true }),
  ).not.toBeChecked();
});

test("editing hierarchy fits every appearance palette on narrow and wide screens", async ({
  page,
}, info) => {
  await demo(page);
  const editor = await settings(page, "checklist");
  await editItem(editor, "General", "Wake-up time");
  for (const theme of ["dark", "light"]) {
    for (const palette of ["classic", "monochrome", "blue-slate"]) {
      await page.evaluate(
        ({ theme, palette }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.appPalette = palette;
          document.documentElement.dataset.antiPalette = "classic";
          document.documentElement.dataset.completionPalette = "forest-rust";
          document.documentElement.style.colorScheme = theme;
        },
        { theme, palette },
      );
      const measurements = await editor.evaluate((element) => {
        const inputs = [
          ...element.querySelectorAll<HTMLElement>("input,select,button"),
        ].filter((control) => control.getClientRects().length);
        const box = element.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          outside: inputs.some(
            (control) => control.getBoundingClientRect().right > box.right + 2,
          ),
          heading: getComputedStyle(element.querySelector("h2")!).color,
          surface: getComputedStyle(element).backgroundColor,
        };
      });
      expect(measurements.overflow).toBeLessThanOrEqual(2);
      expect(measurements.outside).toBe(false);
      expect(measurements.heading).not.toBe(measurements.surface);
      if (
        (theme === "dark" && palette === "classic") ||
        (theme === "light" && palette === "blue-slate")
      )
        await page.screenshot({
          path: `/tmp/180-editor-${theme}-${palette}-${info.project.name}.png`,
        });
    }
  }
});

test("stale recovered forms merge unrelated settings and require an explicit choice for conflicting fields", async ({
  page,
}) => {
  await demo(page);
  let currentLabel = "Wake-up time";
  for (const [index, choice] of [
    "Use latest settings",
    "Keep my changes",
  ].entries()) {
    let editor = await settings(page, "checklist");
    await editItem(editor, "General", currentLabel);
    const localLabel = `My wake-up ${index + 1}`;
    const sharedLabel = `Shared wake-up ${index + 1}`;
    const helper = `My reminder ${index + 1}`;
    await editor
      .getByRole("textbox", { name: "Question", exact: true })
      .fill(localLabel);
    await advanced(editor);
    await editor
      .getByRole("textbox", { name: "Subtext (optional)", exact: true })
      .fill(helper);

    // Simulate a synced configuration arriving after this unfinished form was saved.
    // Read the account-scoped recovery record rather than inventing item identities.
    const readRecovery = () =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("180-private");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const key = `customization-editor:checklist:${sessionStorage.getItem("180:demo-session")}`;
        const record = await new Promise<{ value: string } | undefined>(
          (resolve, reject) => {
            const request = database
              .transaction("meta")
              .objectStore("meta")
              .get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        database.close();
        return record ? JSON.parse(record.value) : null;
      });
    await expect
      .poll(async () => (await readRecovery())?.form?.value?.helper)
      .toBe(helper);
    await page.evaluate(
      async ({ sharedLabel, threshold }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("180-private");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const userId = sessionStorage.getItem("180:demo-session")!;
        const records = await new Promise<{ value: string }>(
          (resolve, reject) => {
            const request = database
              .transaction("meta")
              .objectStore("meta")
              .get(`customization-editor:checklist:${userId}`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        const form = JSON.parse(records.value).form;
        const changes = await new Promise<
          { sequence: number; userId: string }[]
        >((resolve, reject) => {
          const request = database
            .transaction("configurations")
            .objectStore("configurations")
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const revision = Math.max(
          0,
          ...changes
            .filter((change) => change.userId === userId)
            .map((change) => change.sequence),
        );
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(
            "configurations",
            "readwrite",
          );
          transaction.objectStore("configurations").put({
            id: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            userId,
            sequence: revision + 1,
            baseRevision: revision,
            revision: revision + 1,
            effectiveDate: "2026-10-13",
            createdAt: new Date().toISOString(),
            patch: {
              items: [
                {
                  id: form.value.id,
                  label: sharedLabel,
                  completion: {
                    op: "compare",
                    field: "value",
                    operator: "lte",
                    value: threshold,
                  },
                },
              ],
            },
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      { sharedLabel, threshold: 585 - index * 30 },
    );
    await page.reload();
    editor = await settings(page, "checklist");
    const conflict = editor.getByRole("alert", {
      name: "Recovered edit conflicts",
      exact: true,
    });
    await expect(conflict).toContainText("question");
    await expect(
      editor.getByRole("textbox", { name: "Question", exact: true }),
    ).toHaveValue(localLabel);
    await expect(editor.getByLabel("Goal time", { exact: true })).toHaveValue(
      index ? "09:15" : "09:45",
    );
    await done(editor);
    await expect(
      editor
        .getByRole("alert")
        .filter({ hasText: "Review the recovered settings" }),
    ).toBeVisible();
    await conflict.getByRole("button", { name: choice, exact: true }).click();
    currentLabel = index ? localLabel : sharedLabel;
    await expect(
      editor.getByRole("textbox", { name: "Question", exact: true }),
    ).toHaveValue(currentLabel);
    await advanced(editor);
    await expect(
      editor.getByRole("textbox", { name: "Subtext (optional)", exact: true }),
    ).toHaveValue(helper);
    await done(editor);
    await publish(editor);
    await expect(page.getByLabel(currentLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(helper, { exact: true })).toBeVisible();
  }
});

test("preview examples start blank after repeated incompatible input and choice changes", async ({
  page,
}) => {
  await demo(page);
  const editor = await settings(page, "checklist");
  await newBlock(editor, "Experiments");
  await newQuestion(editor, "Experiments", "Flexible answer", "number");
  const preview = editor.getByRole("region", {
    name: "Checklist preview",
    exact: true,
  });
  const progress = preview.getByLabel("Experiments checklist progress", {
    exact: true,
  });
  const showPreview = () =>
    editor.getByRole("button", { name: "Preview", exact: true }).click();
  const back = () =>
    editor.getByRole("button", { name: "Back to editor", exact: true }).click();
  const changeType = (kind: string) =>
    editor
      .getByRole("combobox", { name: "Answer type", exact: true })
      .selectOption(kind);

  await showPreview();
  await preview
    .getByRole("spinbutton", { name: "Flexible answer", exact: true })
    .fill("37");
  await expect(progress).toHaveText("1/1 complete");
  await back();
  await changeType("text");
  await showPreview();
  await expect(
    preview.getByRole("textbox", { name: "Flexible answer", exact: true }),
  ).toHaveValue("");
  await expect(progress).toHaveText("0/1 complete");
  await preview
    .getByRole("textbox", { name: "Flexible answer", exact: true })
    .fill("A text example");
  await back();
  await changeType("duration");
  await showPreview();
  await expect(
    preview.getByRole("spinbutton", {
      name: "Flexible answer hours",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    preview.getByRole("spinbutton", {
      name: "Flexible answer minutes",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(progress).toHaveText("0/1 complete");
  await preview
    .getByRole("spinbutton", { name: "Flexible answer hours", exact: true })
    .fill("1");
  await back();
  await changeType("choice");
  await editor.getByRole("button", { name: "Add choice", exact: true }).click();
  await showPreview();
  await expect(preview.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(progress).toHaveText("0/1 complete");
  await preview.getByRole("radio", { name: "Choice 1", exact: true }).check();
  await expect(progress).toHaveText("1/1 complete");
  await back();
  await editor
    .getByRole("button", { name: "Remove Choice 2", exact: true })
    .click();
  await showPreview();
  await expect(preview.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(progress).toHaveText("0/1 complete");
  await preview.getByRole("radio", { name: "Choice 1", exact: true }).check();
  await back();
  await changeType("checkbox");
  await showPreview();
  await expect(
    preview.getByRole("checkbox", { name: "Flexible answer", exact: true }),
  ).not.toBeChecked();
  await expect(progress).toHaveText("0/1 complete");
});
