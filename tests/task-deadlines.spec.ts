import { expect, test, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

const row = (page: Page, title: string) =>
  page.getByRole("group", { name: `Task ${title}`, exact: true });
const dialog = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true });
async function tasks(page: Page) {
  await page.getByRole("button", { name: "To-do", exact: true }).click();
}
async function menu(page: Page, title: string) {
  await row(page, title).focus();
  await row(page, title).press("Shift+F10");
  return dialog(page, "Task options");
}
async function begin(page: Page, topic: string, title: string) {
  await page
    .getByRole("textbox", { name: `New ${topic} task`, exact: true })
    .fill(title);
  await page
    .getByRole("button", { name: `Add ${topic} task`, exact: true })
    .click();
  return dialog(page, "Add task options");
}
async function add(
  page: Page,
  topic: string,
  title: string,
  date?: string,
  time?: string,
  priority = false,
) {
  const options = await begin(page, topic, title);
  await expect(
    options.getByRole("checkbox", { name: "Include a due date", exact: true }),
  ).not.toBeChecked();
  if (priority)
    await options
      .getByRole("checkbox", { name: "High priority", exact: true })
      .check();
  if (date) {
    await options
      .getByRole("checkbox", { name: "Include a due date", exact: true })
      .check();
    await options.getByLabel("Due date", { exact: true }).fill(date);
    if (time) {
      await options
        .getByRole("checkbox", { name: "Include a time", exact: true })
        .check();
      await options.getByLabel("Due time", { exact: true }).fill(time);
    }
  }
  await options.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(row(page, title)).toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("180-private");
      r.onsuccess = () => resolve(r.result);
    });
    const get = (name: string) =>
      new Promise<any[]>((resolve) => {
        const r = database.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [tasks, events, entries, outbox] = await Promise.all([
      get("tasks"),
      get("taskEvents"),
      get("entries"),
      get("outbox"),
    ]);
    database.close();
    return { tasks, events, entries, outbox };
  });
}

test("demo root deadlines work across topics, sort after priority, edit and clear without affecting history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await tasks(page);
  await expect(page.locator(".task-due")).toHaveCount(0);
  const before = await snapshot(page);
  await add(page, "school", "Essay due today", "2026-10-13", "17:00", true);
  await add(page, "career", "Interview preparation", "2026-10-14");
  await add(page, "life", "Return a parcel", "2026-10-12");
  await expect(row(page, "Essay due today")).toContainText(
    "Due today · 5:00 PM",
  );
  await expect(row(page, "Interview preparation")).toContainText(
    "Due tomorrow",
  );
  await expect(row(page, "Return a parcel").locator(".task-due")).toHaveClass(
    /is-overdue/,
  );
  await expect(
    page.locator('[data-block="School"] .task-list > li > .task-row').first(),
  ).toHaveAttribute("aria-label", "Task Essay due today");
  await row(page, "Essay due today").screenshot({
    path: `test-results/task-deadlines/demo-${test.info().project.name}.png`,
  });
  await page
    .getByRole("button", {
      name: "Add subtask to Essay due today",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "New subtask", exact: true })
    .fill("Outline");
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(
    dialog(page, "Add subtask options").getByText("Include a due date", {
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog(page, "Add subtask options")
    .getByRole("button", { name: "Add subtask", exact: true })
    .click();
  const childMenu = await menu(page, "Outline");
  await expect(
    childMenu.getByRole("button", { name: /due date/i }),
  ).toHaveCount(0);
  await childMenu
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await (
    await menu(page, "Essay due today")
  )
    .getByRole("button", { name: "Edit due date", exact: true })
    .click();
  const edit = dialog(page, "Due date");
  await expect(edit).toContainText("America/New_York");
  await expect(edit.getByLabel("Due time", { exact: true })).toHaveValue(
    "17:00",
  );
  await edit.getByLabel("Due date", { exact: true }).fill("2026-10-20");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row(page, "Essay due today")).toContainText(
    "Due today · 5:00 PM",
  );
  await (
    await menu(page, "Essay due today")
  )
    .getByRole("button", { name: "Edit due date", exact: true })
    .click();
  await edit
    .getByRole("checkbox", { name: "Include a time", exact: true })
    .uncheck();
  await edit
    .getByRole("button", { name: "Save due date", exact: true })
    .click();
  await expect(row(page, "Essay due today").locator(".task-due")).toHaveText(
    "Due today",
  );
  await (
    await menu(page, "Essay due today")
  )
    .getByRole("button", { name: "Remove due date", exact: true })
    .click();
  await expect(row(page, "Essay due today").locator(".task-due")).toHaveCount(
    0,
  );
  const after = await snapshot(page);
  expect(after.events).toEqual(before.events);
  expect(after.entries).toEqual(before.entries);
  expect(after.outbox).toEqual([]);
  expect(
    after.tasks.find((task) => task.title === "Outline").deadline,
  ).toBeNull();
});

test("private deadlines turn overdue at midnight and their exact time, work offline and preserve completion expiry", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-10-15T23:59:50-04:00") });
  await openPrivateApp(page);
  await tasks(page);
  await add(page, "life", "Library books", "2026-10-15");
  await add(page, "life", "Call advisor", "2026-10-16", "00:01");
  await expect(row(page, "Library books").locator(".task-due")).toHaveText(
    "Due today",
  );
  await page.clock.fastForward("00:00:10");
  await expect(row(page, "Library books").locator(".task-due")).toHaveText(
    "Overdue · Oct 15",
  );
  await expect(row(page, "Call advisor").locator(".task-due")).toHaveText(
    "Due today · 12:01 AM",
  );
  await page
    .getByRole("button", { name: "Show daily checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day 7", exact: true }),
  ).toBeVisible(); // Before 2 AM.
  await tasks(page);
  await page.clock.fastForward("00:01:00");
  await expect(row(page, "Call advisor").locator(".task-due")).toHaveClass(
    /is-overdue/,
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await tasks(page);
  await expect(row(page, "Library books").locator(".task-due")).toHaveClass(
    /is-overdue/,
  );
  await row(page, "Call advisor").getByRole("checkbox").check();
  await expect(row(page, "Call advisor").locator(".task-due")).not.toHaveClass(
    /is-overdue/,
  );
  const before = await snapshot(page);
  await (
    await menu(page, "Call advisor")
  )
    .getByRole("button", { name: "Edit due date", exact: true })
    .click();
  await dialog(page, "Due date")
    .getByLabel("Due date", { exact: true })
    .fill("2026-10-20");
  await dialog(page, "Due date")
    .getByRole("button", { name: "Save due date", exact: true })
    .click();
  const after = await snapshot(page);
  expect(
    after.tasks.find((task) => task.title === "Call advisor").completedAt,
  ).toBe(
    before.tasks.find((task) => task.title === "Call advisor").completedAt,
  );
  expect(after.events).toEqual(before.events);
  expect(after.entries).toEqual(before.entries);
  await page.clock.fastForward("12:00:00");
  await expect(row(page, "Call advisor")).toHaveCount(0);
});

test("timed deadlines keep their instant after travel and reject spring-forward gaps", async ({
  page,
  browser,
}) => {
  await page.clock.install({ time: new Date("2026-10-15T12:00:00-04:00") });
  await openPrivateApp(page);
  await tasks(page);
  await add(page, "school", "Travel-safe deadline", "2026-10-16", "17:00");
  await add(page, "life", "Date-only errand", "2026-10-16");
  const original = await snapshot(page);
  const stored = original.tasks.find(
    (task) => task.title === "Travel-safe deadline",
  ).deadline;
  // Reopen the same synthetic task records in a real second browser timezone.
  const west = await browser.newContext({
    timezoneId: "America/Los_Angeles",
    viewport: page.viewportSize()!,
  });
  try {
    const traveled = await west.newPage();
    await traveled.clock.install({
      time: new Date("2026-10-15T12:00:00-04:00"),
    });
    await openPrivateApp(traveled);
    await traveled.evaluate(async (rows) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("180-private");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction("tasks", "readwrite");
        for (const task of rows) tx.objectStore("tasks").put(task);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    }, original.tasks);
    await traveled.reload();
    await tasks(traveled);
    await expect(row(traveled, "Travel-safe deadline")).toContainText(
      "Due tomorrow · 2:00 PM",
    );
    await expect(row(traveled, "Date-only errand")).toContainText(
      "Due tomorrow",
    );
    await (
      await menu(traveled, "Travel-safe deadline")
    )
      .getByRole("button", { name: "Edit due date", exact: true })
      .click();
    const edit = dialog(traveled, "Due date");
    await expect(edit).toContainText("America/Los_Angeles");
    await expect(edit.getByLabel("Due time", { exact: true })).toHaveValue(
      "14:00",
    );
    await edit
      .getByRole("button", { name: "Save due date", exact: true })
      .click();
    expect(
      (await snapshot(traveled)).tasks.find(
        (task) => task.title === "Travel-safe deadline",
      ).deadline,
    ).toEqual(stored);
    await (
      await menu(traveled, "Travel-safe deadline")
    )
      .getByRole("button", { name: "Edit due date", exact: true })
      .click();
    await edit.getByLabel("Due date", { exact: true }).fill("2027-03-14");
    await edit.getByLabel("Due time", { exact: true }).fill("02:30");
    await edit
      .getByRole("button", { name: "Save due date", exact: true })
      .click();
    await expect(edit.getByRole("alert")).toContainText("doesn’t exist");
    expect(
      (await snapshot(traveled)).tasks.find(
        (task) => task.title === "Travel-safe deadline",
      ).deadline,
    ).toEqual(stored);
  } finally {
    await west.close();
  }
});

test("overdue labels preserve priority styling, remain legible across app palettes, and wrap on phones", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await tasks(page);
  const title =
    "Submit the final scholarship application and supporting documents";
  await add(page, "career", title, "2026-10-12", "17:00", true);
  for (const mode of ["Light", "Dark"])
    for (const palette of ["Classic", "Monochrome", "Blue Slate"]) {
      await page
        .getByRole("button", {
          name: "Account and app information",
          exact: true,
        })
        .click();
      const settings = dialog(page, "Your space");
      await settings
        .getByRole("group", { name: "Mode", exact: true })
        .getByRole("button", { name: mode, exact: true })
        .click();
      await settings
        .getByRole("group", { name: "App theme", exact: true })
        .getByRole("button", { name: palette, exact: true })
        .click();
      await settings
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      const task = row(page, title);
      const style = await task.evaluate((element) => {
        const root = getComputedStyle(element);
        const label = getComputedStyle(element.querySelector(".task-due")!);
        const ctx = document.createElement("canvas").getContext("2d")!;
        const rgb = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = (color: number[]) =>
          color
            .map((c) => c / 255)
            .map((c) =>
              c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(rgb(label.color)),
          b = luminance(rgb(root.backgroundColor));
        return {
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          overflow: element.scrollWidth > element.clientWidth,
          background: root.backgroundColor,
          priority: rgb(root.getPropertyValue("--priority-background")),
          actual: rgb(root.backgroundColor),
        };
      });
      expect(style.actual).toEqual(style.priority);
      expect(style.contrast).toBeGreaterThanOrEqual(4.5);
      expect(style.overflow).toBe(false);
      await expect(
        task.getByRole("img", { name: "High priority", exact: true }),
      ).toBeVisible();
    }
  await row(page, title).screenshot({
    path: `test-results/task-deadlines/overdue-${test.info().project.name}.png`,
  });
});
