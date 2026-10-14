import { test, expect, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

async function open(page: Page) {
  await page.clock.install({ time: new Date("2026-10-14T12:00:00-04:00") });
  await openPrivateApp(page);
  await page.getByRole("button", { name: "To-do", exact: true }).click();
}
async function begin(page: Page, title: string) {
  await page
    .getByRole("textbox", { name: "New school task", exact: true })
    .fill(title);
  await page
    .getByRole("button", { name: "Add school task", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Add task options", exact: true });
}
async function add(page: Page, title: string) {
  const dialog = await begin(page, title);
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(row(page, title)).toBeVisible();
}
function row(page: Page, title: string) {
  return page.getByRole("group", { name: `Task ${title}`, exact: true });
}
async function menu(page: Page, title: string) {
  await row(page, title).focus();
  await row(page, title).press("Shift+F10");
  return page.getByRole("dialog", { name: "Task options", exact: true });
}
function titles(page: Page) {
  return page.locator(
    '.task-topics [data-block="School"] .task-list > li > .task-row .task-title',
  );
}

test("creation offers both optional settings, cancel keeps the draft, and priority sorting survives completion and reload", async ({
  page,
  context,
}) => {
  await open(page);
  await add(page, "Ordinary task");
  let dialog = await begin(page, "Important task");
  await expect(
    dialog.getByRole("checkbox", { name: "Include an estimated time" }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "High priority", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "New school task" }),
  ).toHaveValue("Important task");
  dialog = await begin(page, "Important task");
  await dialog
    .getByRole("checkbox", { name: "Include an estimated time" })
    .check();
  await dialog.getByRole("spinbutton", { name: "Estimated hours" }).fill("1");
  await dialog
    .getByRole("spinbutton", { name: "Estimated minutes" })
    .fill("30");
  await dialog
    .getByRole("checkbox", { name: "High priority", exact: true })
    .check();
  await page.screenshot({
    path: `test-results/task-options/dialog-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(titles(page)).toHaveText(["Important task", "Ordinary task"]);
  await expect(row(page, "Important task")).toContainText("Est. 1 hr 30 min");
  await expect(row(page, "Important task")).toHaveCSS(
    "background-color",
    "rgb(248, 237, 216)",
  );
  await expect(row(page, "Important task").getByRole("checkbox")).toHaveCSS(
    "border-color",
    "rgb(163, 107, 34)",
  );
  await page.screenshot({
    path: `test-results/task-options/light-${test.info().project.name}.png`,
    fullPage: true,
  });
  await row(page, "Important task").getByRole("checkbox").check();
  await expect(titles(page)).toHaveText(["Ordinary task", "Important task"]);
  await row(page, "Important task").getByRole("checkbox").uncheck();
  await expect(titles(page)).toHaveText(["Important task", "Ordinary task"]);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(row(page, "Important task")).toContainText("Est. 1 hr 30 min");
  await expect(titles(page)).toHaveText(["Important task", "Ordinary task"]);
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("dialog", { name: "Your space" })
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(row(page, "Important task")).toHaveCSS(
    "background-color",
    "rgb(70, 60, 44)",
  );
  await page.screenshot({
    path: `test-results/task-options/dark-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("long press options add edit and remove estimates and priority without changing task completion timing", async ({
  page,
}) => {
  await open(page);
  await add(page, "Existing task");
  await add(page, "Later task");
  // Exercise the actual hold gesture once; keyboard path is used for the remaining menu interactions.
  await row(page, "Later task").dispatchEvent("pointerdown", {
    button: 0,
    clientX: 40,
    clientY: 40,
  });
  await page.clock.fastForward(550);
  let options = page.getByRole("dialog", { name: "Task options", exact: true });
  await expect(options).toBeVisible();
  await options
    .getByRole("button", { name: "Mark high priority", exact: true })
    .click();
  await expect(titles(page)).toHaveText(["Later task", "Existing task"]);
  options = await menu(page, "Later task");
  await options
    .getByRole("button", { name: "Add estimated time", exact: true })
    .click();
  let estimate = page.getByRole("dialog", {
    name: "Estimated time",
    exact: true,
  });
  await estimate
    .getByRole("button", { name: "Save estimated time", exact: true })
    .click();
  await expect(estimate.getByRole("alert")).toBeVisible();
  await estimate
    .getByRole("spinbutton", { name: "Estimated minutes" })
    .fill("45");
  await estimate
    .getByRole("button", { name: "Save estimated time", exact: true })
    .click();
  await expect(row(page, "Later task")).toContainText("Est. 45 min");
  options = await menu(page, "Later task");
  await options
    .getByRole("button", { name: "Edit estimated time", exact: true })
    .click();
  estimate = page.getByRole("dialog", { name: "Estimated time", exact: true });
  await estimate.getByRole("spinbutton", { name: "Estimated hours" }).fill("2");
  await estimate
    .getByRole("spinbutton", { name: "Estimated minutes" })
    .fill("0");
  await estimate
    .getByRole("button", { name: "Save estimated time", exact: true })
    .click();
  await expect(row(page, "Later task")).toContainText("Est. 2 hr");
  options = await menu(page, "Later task");
  await options
    .getByRole("button", { name: "Remove high priority", exact: true })
    .click();
  await expect(titles(page)).toHaveText(["Existing task", "Later task"]);
  await row(page, "Later task").getByRole("checkbox").check();
  await page.clock.fastForward("11:00:00");
  options = await menu(page, "Later task");
  await options
    .getByRole("button", { name: "Remove estimated time", exact: true })
    .click();
  await expect(row(page, "Later task").locator(".task-estimate")).toHaveCount(
    0,
  );
  await expect(row(page, "Later task").getByRole("checkbox")).toBeChecked();
  await page.clock.fastForward("01:00:01");
  await expect(row(page, "Later task")).toHaveCount(0);
});

test("subtasks offer durations but no priority and preserve parent progress and metadata", async ({
  page,
}) => {
  await open(page);
  const dialog = await begin(page, "Essay");
  await dialog
    .getByRole("checkbox", { name: "High priority", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByRole("button", { name: "Add subtask to Essay", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New subtask", exact: true })
    .fill("Outline");
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  const childOptions = page.getByRole("dialog", {
    name: "Add subtask options",
    exact: true,
  });
  await expect(
    childOptions.getByRole("checkbox", { name: "High priority", exact: true }),
  ).toHaveCount(0);
  await childOptions
    .getByRole("checkbox", { name: "Include an estimated time" })
    .check();
  await childOptions
    .getByRole("spinbutton", { name: "Estimated minutes" })
    .fill("20");
  await childOptions
    .getByRole("button", { name: "Add subtask", exact: true })
    .click();
  await expect(row(page, "Outline")).toContainText("Est. 20 min");
  await expect(row(page, "Essay")).toContainText("0 of 1 complete");
  const options = await menu(page, "Outline");
  await expect(options.getByRole("button", { name: /priority/ })).toHaveCount(
    0,
  );
  await expect(
    options.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(
    options.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await options
    .getByRole("button", { name: "Remove estimated time", exact: true })
    .click();
  await expect(row(page, "Outline").locator(".task-estimate")).toHaveCount(0);
  await expect(row(page, "Essay")).toHaveClass(/is-high-priority/);
  await row(page, "Outline").getByRole("checkbox").check();
  await expect(row(page, "Essay").getByRole("checkbox")).toBeChecked();
});

test("fresh demo tasks show priority only, duration only, and both", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(row(page, "Prepare history essay")).toContainText(
    "High priority",
  );
  await expect(
    row(page, "Prepare history essay").locator(".task-estimate"),
  ).toHaveCount(0);
  await expect(row(page, "Draft an outline")).toContainText("Est. 20 min");
  await expect(
    row(page, "Draft an outline").locator(".task-priority"),
  ).toHaveCount(0);
  await expect(row(page, "Practice common interview questions")).toContainText(
    "Est. 45 min",
  );
  await expect(row(page, "Practice common interview questions")).toContainText(
    "High priority",
  );
});
