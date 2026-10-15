import { test, expect, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";
const todo = (page: Page) =>
  page.getByRole("button", { name: "To-do", exact: true }).click();
const daily = (page: Page) =>
  page.getByRole("button", { name: "Show daily checklist" }).click();
const check = (page: Page, title: string) =>
  page.getByRole("checkbox", { name: `Complete ${title}`, exact: true });
const answer = (page: Page, topic: string, value = "Yes") =>
  page
    .getByRole("group", { name: `Worked on ${topic} tasks`, exact: true })
    .getByRole("button", { name: value, exact: true });
const recorded = (page: Page, topic = "school") =>
  page.getByRole("group", { name: `Recorded ${topic} tasks`, exact: true });
async function open(page: Page, date = "2026-10-14T12:00:00-04:00") {
  await page.clock.install({ time: new Date(date) });
  await openPrivateApp(page);
}
async function add(
  page: Page,
  title: string,
  topic = "school",
  parent?: string,
) {
  if (
    parent &&
    !(await page
      .getByRole("textbox", { name: "New subtask", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: `Add subtask to ${parent}`, exact: true })
      .click();
  await page
    .getByRole("textbox", {
      name: parent ? "New subtask" : `New ${topic} task`,
      exact: true,
    })
    .fill(title);
  await page
    .getByRole("button", {
      name: parent ? "Add subtask" : `Add ${topic} task`,
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: parent ? "Add subtask" : "Add task",
      exact: true,
    })
    .click();
  await expect(check(page, title)).toBeVisible();
}
async function picker(page: Page, topic = "school") {
  const button = page.getByRole("button", {
    name: `Choose ${topic} tasks`,
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  return page.getByRole("group", {
    name: `${topic === "school" ? "School" : "Career"} tasks worked on`,
    exact: true,
  });
}
async function remove(page: Page, title: string) {
  const row = page.getByRole("group", { name: `Task ${title}`, exact: true });
  await expect(row).toHaveAttribute("tabindex", "0");
  await row.press("Shift+F10");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("button", {
    name: "Delete task",
    exact: true,
  });
  if (await confirm.count()) await confirm.click();
}

test("completion records child hierarchy and School/Career progress immediately; undo affects only automatic work", async ({
  page,
}) => {
  await open(page);
  await todo(page);
  await add(page, "Essay");
  await add(page, "Outline", "school", "Essay");
  await add(page, "Write", "school", "Essay");
  await add(page, "Resume", "career");
  await daily(page);
  await answer(page, "school", "No").click();
  await page
    .getByRole("textbox", { name: "Worked on school tasks reason" })
    .fill("Keep reason");
  await todo(page);
  await check(page, "Outline").check();
  await expect(check(page, "Essay")).not.toBeChecked();
  await daily(page);
  await expect(answer(page, "school")).toHaveAttribute("aria-pressed", "true");
  await expect(recorded(page)).toContainText("Essay");
  await expect(recorded(page)).toContainText("Outline");
  await expect(recorded(page)).not.toContainText("Write");
  await expect(
    page.getByLabel("School checklist progress", { exact: true }),
  ).toHaveText("1/2 complete");
  await todo(page);
  await check(page, "Write").check();
  await check(page, "Resume").check();
  await expect(check(page, "Essay")).toBeChecked();
  await daily(page);
  await expect(recorded(page).locator(":scope > ul > li")).toHaveCount(1);
  await expect(recorded(page).locator("ul ul > li")).toHaveCount(2);
  await expect(answer(page, "career")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("2/16 checks complete");
  await todo(page);
  await check(page, "Outline").uncheck();
  await daily(page);
  await expect(recorded(page)).toContainText("Write");
  await expect(recorded(page)).not.toContainText("Outline");
  await todo(page);
  await check(page, "Write").uncheck();
  await daily(page);
  await expect(answer(page, "school")).toHaveAttribute("aria-pressed", "false");
  await expect(answer(page, "school", "No")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await answer(page, "school", "No").click();
  await expect(
    page.getByRole("textbox", { name: "Worked on school tasks reason" }),
  ).toHaveValue("Keep reason");
});

test("manual parent survives automatic child undo; automatic container keeps a manually selected child", async ({
  page,
}) => {
  await open(page);
  await todo(page);
  await add(page, "Essay");
  await add(page, "Outline", "school", "Essay");
  await add(page, "Research", "school", "Essay");
  await daily(page);
  await answer(page, "school").click();
  let choices = await picker(page);
  await choices.getByRole("checkbox", { name: "Essay", exact: true }).check();
  await todo(page);
  await check(page, "Outline").check();
  await check(page, "Outline").uncheck();
  await daily(page);
  await expect(recorded(page)).toContainText("Essay");
  await expect(recorded(page)).not.toContainText("Outline");
  choices = await picker(page);
  await choices.getByRole("checkbox", { name: "Essay", exact: true }).uncheck();
  await todo(page);
  await check(page, "Outline").check();
  await daily(page);
  choices = await picker(page);
  await choices
    .getByRole("checkbox", { name: "Research", exact: true })
    .check();
  await todo(page);
  await check(page, "Outline").uncheck();
  await daily(page);
  await expect(answer(page, "school")).toHaveAttribute("aria-pressed", "true");
  await expect(recorded(page)).toContainText("Research");
  await expect(recorded(page)).not.toContainText("Outline");
  // Removing the last manual child also removes its empty automatic container.
  choices = await picker(page);
  await choices
    .getByRole("checkbox", { name: "Research", exact: true })
    .click(); // Removing the last child also unmounts this checkbox.
  await expect(recorded(page)).not.toContainText("Essay");
});

test("manual removal and answer edits persist offline; genuine recheck records fresh work and icon-only control remains keyboard accessible", async ({
  page,
  context,
}) => {
  await open(page);
  await todo(page);
  await add(page, "Homework");
  const addChild = page.getByRole("button", {
    name: "Add subtask to Homework",
    exact: true,
  });
  await expect(addChild).toHaveText("");
  await expect(addChild.locator("svg")).toHaveAttribute("width", "18");
  await addChild.focus();
  await expect(addChild).toBeFocused();
  await addChild.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "New subtask", exact: true }),
  ).toBeVisible();
  await check(page, "Homework").check();
  await daily(page);
  const choices = await picker(page);
  await choices
    .getByRole("checkbox", { name: "Homework Completed", exact: true })
    .uncheck();
  await answer(page, "school", "No").click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(answer(page, "school", "No")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await todo(page);
  await check(page, "Homework").uncheck();
  await check(page, "Homework").check();
  await daily(page);
  await expect(answer(page, "school")).toHaveAttribute("aria-pressed", "true");
  await expect(recorded(page)).toContainText("Homework");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/private-screenshots/180-auto-work-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("completion targets its operation day while history stays open; later undo and deletion preserve snapshots", async ({
  page,
}) => {
  await open(page, "2026-10-13T23:00:00-04:00");
  await todo(page);
  await add(page, "Essay");
  await add(page, "Old child", "school", "Essay");
  await add(page, "Last child", "school", "Essay");
  await check(page, "Old child").check();
  await daily(page);
  await page.getByRole("button", { name: "Previous day" }).click();
  await todo(page);
  await page.clock.fastForward("03:01:00");
  await check(page, "Last child").check();
  await daily(page); // Previously open October 12 remains selected.
  await expect(recorded(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(recorded(page)).toContainText("Last child");
  await expect(recorded(page)).not.toContainText("Old child");
  await todo(page);
  await check(page, "Old child").uncheck();
  await remove(page, "Old child"); // Parent auto-completes from deletion, adds no children.
  await daily(page);
  await expect(recorded(page).locator("ul ul > li")).toHaveCount(1);
  await todo(page);
  await page
    .getByRole("group", { name: "Task Essay", exact: true })
    .press("Shift+F10");
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Renamed essay");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await remove(page, "Renamed essay");
  await daily(page);
  await expect(recorded(page)).toContainText("Essay");
  await expect(recorded(page)).toContainText("Last child");
  await expect(recorded(page)).not.toContainText("Renamed essay");
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(recorded(page)).toContainText("Old child");
  await expect(recorded(page)).not.toContainText("Last child");
});
