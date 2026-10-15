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
  await editor.getByRole("button", { name: "Add block", exact: true }).click();
  const block = editor.getByRole("region", {
    name: "Edit New block",
    exact: true,
  });
  await block
    .getByRole("textbox", { name: "Block title", exact: true })
    .fill(title);
  return editor.getByRole("region", { name: `Edit ${title}`, exact: true });
}
async function newQuestion(
  block: Locator,
  blockTitle: string,
  label: string,
  kind = "boolean",
) {
  await block
    .getByRole("button", { name: `Add item to ${blockTitle}`, exact: true })
    .click();
  const item = block.locator(".customization-item-list > details").last();
  await item.locator(":scope > summary").click();
  await item
    .getByRole("textbox", { name: "Item label", exact: true })
    .fill(label);
  if (kind !== "boolean")
    await item
      .getByRole("combobox", { name: "Input type", exact: true })
      .selectOption(kind);
  return item;
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
  await block
    .getByRole("combobox", { name: "Block icon", exact: true })
    .selectOption("leaf");
  const item = await newQuestion(
    block,
    "Wellbeing",
    "Glasses of water",
    "number",
  );
  await item
    .getByRole("spinbutton", { name: "Threshold", exact: true })
    .fill("2");
  await item
    .getByRole("textbox", {
      name: "Subtext / instructions (optional)",
      exact: true,
    })
    .fill("A glass is about 250 ml.");
  await item.getByText("Schedule", { exact: true }).click();
  const weekdays = item.getByRole("group", { name: "Appears on", exact: true });
  for (const day of ["Sun", "Mon", "Wed", "Thu", "Fri", "Sat"])
    await weekdays.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await item.getByText("Follow-up fields (0)", { exact: true }).click();
  await item.getByRole("button", { name: "Add note", exact: true }).click();
  const followup = item
    .locator(".customization-section")
    .filter({
      has: page.getByRole("textbox", { name: "Follow-up label", exact: true }),
    })
    .last();
  await followup
    .getByRole("textbox", { name: "Follow-up label", exact: true })
    .fill("Extra context");
  await followup
    .getByRole("combobox", { name: "Follow-up visibility rule", exact: true })
    .selectOption("compare");
  await followup
    .getByRole("combobox", { name: "Threshold comparison", exact: true })
    .selectOption("gt");
  await followup
    .getByRole("spinbutton", { name: "Threshold", exact: true })
    .fill("4");
  const preview = editor.getByRole("complementary", {
    name: "Checklist live preview",
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
    preview.getByText("Glasses of water", { exact: true }),
  ).not.toBeVisible();
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
  const savedItem = editor
    .getByRole("region", { name: "Edit Wellbeing", exact: true })
    .locator(".customization-item-list > details")
    .first();
  await savedItem.locator(":scope > summary").click();
  await savedItem
    .getByRole("combobox", { name: "Input type", exact: true })
    .selectOption("text");
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
  await publish(editor, "Start next day");
  await expect(
    page.getByRole("region", { name: "Future routine", exact: true }),
  ).not.toBeVisible();
  editor = await settings(page, "checklist");
  await editor
    .getByRole("region", { name: "Edit General", exact: true })
    .getByRole("textbox", { name: "Block title", exact: true })
    .fill("Morning routine");
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
  await item.getByRole("button", { name: "Duplicate", exact: true }).click();
  const duplicate = block.locator(".customization-item-list > details").last();
  await duplicate.locator(":scope > summary").click();
  await duplicate
    .getByRole("combobox", { name: "Block", exact: true })
    .selectOption("general");
  item = await newQuestion(block, "Practice", "Write", "text");
  await item
    .getByRole("button", { name: "Move Write up", exact: true })
    .click();
  await block
    .getByRole("textbox", { name: "Block title", exact: true })
    .fill("Creativity");
  const renamed = editor.getByRole("region", {
    name: "Edit Creativity",
    exact: true,
  });
  await renamed
    .getByRole("button", { name: "Move Creativity up", exact: true })
    .click();
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
  const fitnessEditor = manager.locator("section").filter({
    has: page.getByRole("heading", { name: "Fitness", exact: true }),
  });
  await fitnessEditor
    .getByRole("button", { name: "Connect to daily checklist", exact: true })
    .click();
  await manager
    .getByRole("combobox", { name: "Question visibility", exact: true })
    .selectOption("always");
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
  page.once("dialog", (dialog) => dialog.accept());
  await manager
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Fitness", exact: true }),
    })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await manager.getByText("Removed lists (1)", { exact: true }).click();
  await manager
    .getByRole("button", { name: "Restore Fitness", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "Fitness", exact: true }),
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
