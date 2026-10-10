import { test, expect, type Page } from "@playwright/test";
async function preview(page: Page, date = "2026-10-12T12:00:00-04:00") {
  await page.clock.install({ time: new Date(date) });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the local preview" }).click();
  await expect(page.getByRole("heading", { name: /Day \d+\./ })).toBeVisible();
}
async function tasks(page: Page) {
  await page.getByRole("button", { name: "Do Stuff", exact: true }).click();
}
async function today(page: Page) {
  await page.getByRole("button", { name: "Show daily check-in" }).click();
}
async function add(page: Page, topic: string, title: string) {
  await page.getByRole("textbox", { name: `New ${topic} task` }).fill(title);
  await page
    .getByRole("button", { name: `Add ${topic} task`, exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: `Complete ${title}`, exact: true }),
  ).toBeVisible();
}
async function child(page: Page, parent: string, title: string) {
  await page
    .getByRole("button", { name: `Add subtask to ${parent}`, exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New subtask", exact: true })
    .fill(title);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: `Complete ${title}`, exact: true }),
  ).toBeVisible();
}
function answer(page: Page, topic: string, choice: string) {
  return page
    .getByRole("group", { name: `Worked on ${topic} tasks?`, exact: true })
    .getByRole("button", { name: choice, exact: true });
}

test("visible task activity questions contribute to block and daily totals", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "school", "Study physics");
  await add(page, "career", "Update resume");
  await today(page);
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("0/15 checks complete");
  await answer(page, "school", "Yes").click();
  await answer(page, "career", "Yes").click();
  await expect(
    page.getByLabel("School checklist progress", { exact: true }),
  ).toHaveText("1/2 complete");
  await expect(
    page.getByLabel("Career checklist progress", { exact: true }),
  ).toHaveText("1/2 complete");
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("2/15 checks complete");
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText("0/14 checks complete");
  await expect(
    page.getByLabel("School checklist progress", { exact: true }),
  ).toHaveText("0/1 complete");
});

test("task groups complete automatically, sort below active tasks, and reset their archive timer", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "school", "Physics");
  await child(page, "Physics", "Read notes");
  await page
    .getByRole("textbox", { name: "New subtask", exact: true })
    .fill("Solve problems");
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Complete Read notes", exact: true })
    .check();
  await page.clock.fastForward("13:00:00");
  await expect(
    page.getByRole("checkbox", { name: "Complete Read notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Complete Solve problems", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).toBeChecked();
  await add(page, "school", "Next homework");
  await expect(
    page.locator(
      '.task-topics [data-block="School"] .task-list > li > .task-row .task-title',
    ),
  ).toHaveText(["Next homework", "Physics"]);
  await page.clock.fastForward("11:00:00");
  await page
    .getByRole("checkbox", { name: "Complete Solve problems", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Complete Solve problems", exact: true })
    .check();
  await page.clock.fastForward("11:59:59");
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward("00:00:01");
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Complete Next homework", exact: true }),
  ).toBeVisible();
});

test("daily parent/child selections remain readable after archive, offline reload, and historical navigation", async ({
  page,
  context,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "school", "Physics");
  await child(page, "Physics", "Read notes");
  await add(page, "school", "Revision");
  await page
    .getByRole("checkbox", { name: "Complete Read notes", exact: true })
    .check();
  await today(page);
  await answer(page, "school", "Yes").click();
  await page.getByRole("button", { name: "Choose school tasks" }).click();
  const picker = page.getByRole("group", {
    name: "School tasks worked on",
    exact: true,
  });
  await picker
    .getByRole("checkbox", { name: "Physics Completed", exact: true })
    .check();
  await picker
    .getByRole("checkbox", { name: "Read notes Completed", exact: true })
    .check();
  await picker.getByRole("checkbox", { name: "Revision", exact: true }).check();
  const recorded = page.getByRole("group", {
    name: "Recorded school tasks",
    exact: true,
  });
  await expect(recorded).toContainText("Physics");
  await expect(recorded).toContainText("Read notes");
  await page.getByRole("button", { name: "Choose school tasks" }).click();
  const field = page.locator(".task-activity").filter({
    has: page.getByRole("group", {
      name: "Worked on school tasks?",
      exact: true,
    }),
  });
  await field.getByRole("button", { name: "Minimize", exact: true }).click();
  await answer(page, "school", "No").click();
  await page
    .getByRole("textbox", { name: "Worked on school tasks? reason" })
    .fill("Saved reason");
  await answer(page, "school", "Yes").click();
  await expect(
    page.getByRole("button", { name: "View tasks worked on (2)" }),
  ).toBeVisible();
  await tasks(page);
  await page
    .getByRole("checkbox", { name: "Complete Revision", exact: true })
    .check();
  await page.clock.fastForward("12:00:00");
  await expect(
    page.getByRole("checkbox", { name: "Complete Physics", exact: true }),
  ).toHaveCount(0);
  await today(page);
  await page.getByRole("button", { name: "View tasks worked on (2)" }).click();
  await expect(recorded).toContainText("Physics");
  await expect(recorded).toContainText("Read notes");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  // Midnight is still the same logical day until 2 AM.
  await expect(recorded).toContainText("Revision");
  await page.clock.fastForward("02:00:01");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Worked on school tasks?", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(recorded).toContainText("Read notes");
  await expect(recorded).toContainText("Physics");
});

test("rename and deletion preserve the recorded task title and delete parents with children", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "career", "Resume");
  await child(page, "Resume", "Draft");
  await today(page);
  await answer(page, "career", "Yes").click();
  await page.getByRole("button", { name: "Choose career tasks" }).click();
  await page
    .getByRole("group", { name: "Career tasks worked on", exact: true })
    .getByRole("checkbox", { name: "Resume", exact: true })
    .check();
  await tasks(page);
  await page
    .getByRole("group", { name: "Task Resume", exact: true })
    .press("Shift+F10");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("New resume");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("group", { name: "Task New resume", exact: true })
    .press("Shift+F10");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete task?" }),
  ).toContainText("and its subtasks");
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Complete Draft", exact: true }),
  ).toHaveCount(0);
  await today(page);
  await expect(
    page.getByRole("group", { name: "Recorded career tasks", exact: true }),
  ).toContainText("Resume");
  await expect(
    page.getByRole("group", { name: "Recorded career tasks", exact: true }),
  ).not.toContainText("New resume");
});

test("school work appears on weekends; historical task edits ask once and Life has no daily prompt", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "school", "Homework");
  await add(page, "life", "Laundry");
  await today(page);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(
    page.getByRole("group", { name: "Attended class", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Worked on school tasks?", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Worked on life tasks?", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day" }).click();
  await answer(page, "school", "Yes").click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Anyway", exact: true }).click();
  await page.getByRole("button", { name: "Choose school tasks" }).click();
  await page
    .getByRole("group", { name: "School tasks worked on", exact: true })
    .getByRole("checkbox", { name: "Homework", exact: true })
    .check();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("holding opens task actions and moving cancels the hold", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "life", "Laundry");
  const title = page.locator(".task-title").filter({ hasText: "Laundry" });
  await title.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  await title.dispatchEvent("pointermove", { clientX: 100, clientY: 125 });
  await page.clock.fastForward(600);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await title.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  await page.clock.fastForward(501);
  await expect(
    page.getByRole("dialog", { name: "Task options" }),
  ).toBeVisible();
  await title.dispatchEvent("pointerup", { button: 0 });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("checkbox", { name: "Complete Laundry", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Complete Laundry", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/180-do-stuff-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("representative task and daily-selection layouts fit desktop and phone", async ({
  page,
}) => {
  await preview(page);
  await tasks(page);
  await add(page, "school", "Finish physics assignment");
  await child(page, "Finish physics assignment", "Review lecture notes");
  await page
    .getByRole("textbox", { name: "New subtask", exact: true })
    .fill("Solve practice problems");
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "Complete Review lecture notes",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Review lecture notes",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", {
      name: "Add subtask to Finish physics assignment",
      exact: true,
    })
    .click();
  await add(page, "school", "Read the next chapter");
  await add(page, "career", "Finish AWS certification course");
  await add(page, "career", "Update resume");
  await page
    .getByRole("checkbox", { name: "Complete Update resume", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Complete Update resume", exact: true }),
  ).toBeChecked();
  await add(page, "life", "Book a dentist appointment");
  await add(page, "life", "Clean desk and sort papers");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/180-do-stuff-${test.info().project.name}.png`,
    fullPage: true,
  });
  await today(page);
  await answer(page, "school", "Yes").click();
  await page.getByRole("button", { name: "Choose school tasks" }).click();
  const picker = page.getByRole("group", {
    name: "School tasks worked on",
    exact: true,
  });
  await picker
    .getByRole("checkbox", { name: "Finish physics assignment", exact: true })
    .check();
  await picker
    .getByRole("checkbox", {
      name: "Review lecture notes Completed",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Choose school tasks" }).click();
  await answer(page, "career", "Yes").click();
  await page.getByRole("button", { name: "Choose career tasks" }).click();
  await page
    .getByRole("group", { name: "Career tasks worked on", exact: true })
    .getByRole("checkbox", { name: "Update resume Completed", exact: true })
    .check();
  await page.getByRole("button", { name: "Choose career tasks" }).click();
  await page.screenshot({
    path: `artifacts/180-task-activity-${test.info().project.name}.png`,
    fullPage: true,
  });
});
