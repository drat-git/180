import { test, expect, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo mode" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("0/15 checks complete");
  await page
    .getByRole("button", { name: "Maximize Career", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Maximize Diet", exact: true })
    .click();
}
const answer = (page: Page, label: string, value: string) =>
  page
    .getByRole("group", { name: label, exact: true })
    .getByRole("button", { name: value, exact: true });
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true });
const saved = (page: Page) =>
  expect(page.locator(".save-state")).toHaveText("Saved on this device");

test("public entry, blank Day 3 and demo-only checklist defaults", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2030-03-15T12:00:00Z") });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("dratgit@gmail.com");
  const demoButton = page.getByRole("button", {
    name: "Try the demo mode",
    exact: true,
  });
  await expect(demoButton).toHaveCSS("font-weight", "700");
  await expect(demoButton).toHaveCSS("border-top-style", "dashed");
  await expect(demoButton.locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(demoButton).toBeVisible();
  await page.screenshot({
    path: `artifacts/180-demo-entry-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Try the demo mode" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".day-title")).toContainText("Tuesday, October 13");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Maximize Career", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Maximize Diet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Minimize General", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("0/15 checks complete");
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".answers button[aria-pressed=true]")).toHaveCount(
    0,
  );
  await expect(
    page
      .getByRole("region", { name: "Diet", exact: true })
      .locator(".field-label"),
  ).toHaveText([
    "Breakfast",
    "Lunch",
    "Dinner",
    "Creatine",
    "SnackFruit, protein bar, boba, etc",
  ]);
  await expect(
    page
      .getByRole("region", { name: "Body", exact: true })
      .locator(".field-label"),
  ).toHaveText(["8500 steps", "Exercised", "Multivitamin"]);
  await expect(
    page.getByRole("group", { name: "Used cannabis?", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Next day", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: `test-results/demo-default-${test.info().project.name}.png`,
    fullPage: true,
  });
  await nav(page, "Calendar").click();
  await expect(
    page.getByRole("heading", { name: "October 2026", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daily checklist", exact: true }),
  ).toBeHidden();
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("past entries show varied samples, absent Sunday school and protected history", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Day 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("10/15 checks complete");
  await expect(page.getByLabel("Wake-up time", { exact: true })).toHaveValue(
    "08:55",
  );
  await expect(
    page.getByLabel("Screen time hours", { exact: true }),
  ).toHaveValue("4");
  await expect(
    page.getByLabel("Screen time minutes", { exact: true }),
  ).toHaveValue("12");
  await expect(
    page.getByRole("status", { name: "How many applications?", exact: true }),
  ).toHaveText("4");
  await expect(answer(page, "Smoothie", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: "Vaping use 1 description" }),
  ).toHaveValue("Once while winding down after project work.");
  await expect(
    page.getByRole("group", { name: "Recorded school tasks" }),
  ).toContainText("Finish statistics practice set");
  await expect(
    page.getByRole("list", { name: "Anti Rotting recap" }),
  ).toContainText("Completed");
  await page.screenshot({
    path: `test-results/demo-day-two-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Day 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("12/13 checks complete");
  await expect(page.getByLabel("Wake-up time", { exact: true })).toHaveValue(
    "07:45",
  );
  await expect(
    page.getByLabel("Screen time hours", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByLabel("Screen time minutes", { exact: true }),
  ).toHaveValue("20");
  await expect(
    page.getByRole("region", { name: "School", exact: true }),
  ).toBeHidden();
  await expect(answer(page, "Meal", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: "Meal food description" }),
  ).toHaveValue("Eggs and toast");
  await expect(
    page.getByRole("group", { name: "Recorded career tasks" }),
  ).toContainText("Refresh LinkedIn profile");
  await expect(
    page.getByRole("button", { name: "Previous day", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Edit entry", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toContainText("Day 1");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveAttribute("readonly", "");
});

test("task groups and anti-rot examples stay visible when real time moves", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2030-01-15T12:00:00Z") });
  await openDemo(page);
  await nav(page, "To-do").click();
  await expect(
    page
      .getByRole("region", { name: "School", exact: true })
      .locator(".task-list > li"),
  ).toHaveCount(3);
  await expect(
    page
      .getByRole("region", { name: "Career", exact: true })
      .locator(".task-list > li"),
  ).toHaveCount(3);
  await expect(
    page
      .getByRole("region", { name: "Life", exact: true })
      .locator(".task-list > li"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Choose a topic",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Draft an outline",
      exact: true,
    }),
  ).not.toBeChecked();
  const project = page.getByRole("group", {
    name: "Task Build a campus events project",
    exact: true,
  });
  await expect(project).toHaveClass(/is-complete/);
  await expect(
    project.locator("..").locator(".task-children input:checked"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("group", {
      name: "Task Refresh LinkedIn profile",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", {
      name: "Task Finish statistics practice set",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/demo-tasks-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.clock.fastForward("24:00:00");
  await expect(project).toHaveClass(/is-complete/);
  await expect(
    page.getByRole("group", { name: "Task Return library books", exact: true }),
  ).toHaveClass(/is-complete/);
  await nav(page, "Anti-rot").click();
  await expect(page.locator(".anti-item")).toHaveCount(6);
  await expect(page.locator(".anti-item input[type=checkbox]")).toHaveCount(2);
  await expect(
    page.getByRole("checkbox", {
      name: "Complete activity Watch a public lecture about space",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.locator(".anti-log-button[aria-pressed=true]")).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `test-results/demo-anti-rot-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("demo thresholds, breakfast choices and local-only visitor actions", async ({
  page,
}) => {
  const cloudWrites: string[] = [];
  page.on("request", (request) => {
    if (/\/rest\/v1|\/storage\/v1|\/functions\/v1/.test(request.url()))
      cloudWrites.push(request.url());
  });
  await openDemo(page);
  await page.getByLabel("Wake-up time", { exact: true }).fill("08:30");
  await expect(page.locator("#wake")).toHaveAttribute("data-complete", "true");
  await page.getByLabel("Wake-up time", { exact: true }).fill("08:31");
  await expect(
    page.getByRole("textbox", { name: "Wake-up time reason" }),
  ).toBeVisible();
  await page.getByLabel("Screen time hours").fill("3");
  await page.getByLabel("Screen time minutes").fill("30");
  await expect(page.locator("#screen-hours")).toHaveAttribute(
    "data-complete",
    "true",
  );
  await page.getByLabel("Screen time minutes").fill("31");
  await expect(
    page.getByRole("textbox", { name: "Screen time reason" }),
  ).toBeVisible();
  await answer(page, "Vaped?", "No").click();
  const completeColor = await answer(page, "Vaped?", "No").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await answer(page, "Vaped?", "Yes").click();
  await expect(page.getByLabel("How many times?", { exact: true })).toHaveText(
    "1",
  );
  await expect(answer(page, "Vaped?", "Yes")).toHaveCSS(
    "background-color",
    "rgb(151, 85, 121)",
  );
  expect(
    await answer(page, "Vaped?", "Yes").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    ),
  ).not.toBe(completeColor);
  await answer(page, "Breakfast", "Yes").click();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await page.getByRole("radio", { name: "Meal", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Meal food description" })
    .fill("Toast");
  await answer(page, "Meal", "Yes").click();
  await answer(page, "Breakfast", "Yes").click();
  await page.getByRole("radio", { name: "Smoothie", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Meal food description" }),
  ).toHaveCount(0);
  await nav(page, "To-do").click();
  await page
    .getByRole("textbox", { name: "New life task", exact: true })
    .fill("Try a visitor task");
  await page
    .getByRole("button", { name: "Add life task", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Add task options" })
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Complete Try a visitor task", exact: true })
    .check();
  await nav(page, "Anti-rot").click();
  await page
    .getByRole("button", {
      name: "Did this: Take a walk without headphones",
      exact: true,
    })
    .click();
  await saved(page);
  expect(cloudWrites).toEqual([]);
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("180-private");
        request.onsuccess = () => resolve(request.result);
      });
      const count = await new Promise<number>((resolve) => {
        const request = database
          .transaction("outbox")
          .objectStore("outbox")
          .count();
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return count;
    }),
  ).toBe(0);
});

test("reload preserves edits offline; reset and new visits restore the samples", async ({
  page,
  context,
}) => {
  await openDemo(page);
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("My visitor journal");
  await page
    .getByRole("button", { name: "Minimize General", exact: true })
    .click();
  await saved(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("My visitor journal");
  await expect(
    page.getByRole("button", { name: "Maximize General", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Minimize General", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("Only this visit");
  await saved(page);
  await page.close();
  await context.setOffline(false);
  const returning = await context.newPage();
  await openDemo(returning);
  await expect(
    returning.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("");
});

test("separate visits do not share edits or reset each other", async ({
  page,
  context,
}) => {
  await openDemo(page);
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("First visitor");
  await saved(page);
  const second = await context.newPage();
  await openDemo(second);
  const firstId = await page.evaluate(() =>
    sessionStorage.getItem("180:demo-session"),
  );
  const secondId = await second.evaluate(() =>
    sessionStorage.getItem("180:demo-session"),
  );
  expect(secondId).not.toBe(firstId);
  await second.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(
    second.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("First visitor");
});

test.describe("demo outside Eastern time", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("keeps dates, Sunday school applicability and new activity on Day 3", async ({
    page,
  }) => {
    await openDemo(page);
    await page
      .getByRole("button", { name: "Previous day", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Previous day", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "School", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByLabel("Daily checklist progress", { exact: true }),
    ).toHaveText("12/13 checks complete");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await nav(page, "Anti-rot").click();
    await page
      .getByRole("button", {
        name: "Did this: Take a walk without headphones",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Remove today’s log for Take a walk without headphones",
        exact: true,
      }),
    ).toBeVisible();
    await nav(page, "Show daily checklist").click();
    await expect(
      page.getByRole("heading", { name: "Day 3", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/demo-day-three-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
});

test("demo theme, reset and uploaded photos cannot alter the private app", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-13T12:00:00-04:00") });
  await openPrivateApp(page);
  await expect(
    page.getByRole("heading", { name: "Day 5", exact: true }),
  ).toBeVisible();
  await expect(nav(page, "Calendar")).toHaveCount(0);
  await expect(answer(page, "Used cannabis?", "Yes")).toBeVisible();
  await expect(answer(page, "AM posture exercises", "Yes")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("Keep my private record");
  await expect(page.locator(".save-state")).toContainText("Sign in to sync");
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toBeVisible();
  await openDemo(page);
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("180:theme")),
  ).toBeNull();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  // Demo appearance is session-specific and now survives reloads.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Add journal photo", { exact: true }).setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toBeVisible();
  await saved(page);
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await openPrivateApp(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("Keep my private record");
  await expect(answer(page, "AM posture exercises", "Yes")).toBeVisible();
  await expect(answer(page, "PM posture exercises", "Yes")).toBeVisible();
  await expect(answer(page, "Lifted", "Yes")).toBeVisible();
  await expect(answer(page, "Creatine", "Yes")).toBeVisible();
  await expect(answer(page, "PM Shake", "Yes")).toBeVisible();
  await expect(nav(page, "Calendar")).toHaveCount(0);
});
