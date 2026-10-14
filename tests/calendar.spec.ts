import { test, expect, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

const calendar = (page: Page) =>
  page.getByRole("region", { name: "Interactive calendar", exact: true });
const preview = (page: Page) =>
  page.getByRole("region", { name: "Day preview", exact: true });
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true });
const dateButton = (page: Page, day: number) =>
  calendar(page).getByRole("button", {
    name: new RegExp(`^\\w+, October ${day}, 2026,`),
  });
async function openCalendar(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await nav(page, "Calendar").click();
  await expect(preview(page)).toBeVisible();
}
async function storedRows(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("180-private");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await Promise.all(
      [
        "entries",
        "tasks",
        "taskEvents",
        "images",
        "outbox",
        "antiLogs",
        "antiEvents",
      ].map(
        (table) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = database
              .transaction(table)
              .objectStore(table)
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    database.close();
    return rows;
  });
}

test("calendar previews exact progress and retained task work without writing records", async ({
  page,
}) => {
  await openCalendar(page);
  const before = await storedRows(page);
  await expect(preview(page)).toContainText("IN PROGRESS");
  await expect(preview(page)).toContainText("No entries recorded");
  await expect(
    dateButton(page, 13).locator(".calendar-bubble"),
  ).not.toHaveAttribute("data-band");
  await expect(dateButton(page, 10)).toBeDisabled();
  await expect(dateButton(page, 14)).toBeDisabled();
  await expect(
    calendar(page).getByRole("button", { name: "Previous month" }),
  ).toBeDisabled();
  await expect(
    calendar(page).getByRole("button", { name: "Next month" }),
  ).toBeDisabled();
  await dateButton(page, 11).click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("12 of 13 checks complete");
  await expect(
    dateButton(page, 11).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "4");
  await expect(
    preview(page).getByLabel("Checklist category progress"),
  ).not.toContainText("School");
  await expect(
    preview(page)
      .getByRole("list", { name: "Activities worked on", exact: true })
      .getByText("Refresh LinkedIn profile", { exact: true }),
  ).toHaveCount(1);
  await dateButton(page, 12).click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("10 of 15 checks complete");
  await expect(
    dateButton(page, 12).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "3");
  await expect(
    preview(page).getByRole("list", {
      name: "Activities worked on",
      exact: true,
    }),
  ).toContainText("Return library books");
  await expect(
    preview(page)
      .getByRole("list", { name: "Activities worked on", exact: true })
      .getByText("Finish statistics practice set", { exact: true }),
  ).toHaveCount(1);
  await expect(preview(page)).not.toContainText("Completed");
  await expect(preview(page)).not.toContainText("Sketch main screens");
  const activities = preview(page).getByRole("list", {
    name: "Activities worked on",
    exact: true,
  });
  await expect(activities).toContainText("Practice guitar for 15 minutes");
  await expect(activities).toContainText("Watch a public lecture about space");
  await expect(
    preview(page).getByRole("heading", { name: /^(School|Career|Life)$/ }),
  ).toHaveCount(0);
  await expect(activities.locator(":scope > li")).toHaveCount(6);
  const positions = await activities
    .locator(":scope > li")
    .evaluateAll((items) =>
      items.map((item) => {
        const { x, y } = item.getBoundingClientRect();
        return { x, y };
      }),
    );
  expect(positions[1].x).toBeGreaterThan(positions[0].x);
  expect(positions[1].y).toBe(positions[0].y);
  if (page.viewportSize()!.width > 600) {
    expect(positions[2].y).toBe(positions[0].y);
    expect(positions[3].y).toBeGreaterThan(positions[0].y);
  } else {
    expect(positions[2].y).toBeGreaterThan(positions[0].y);
  }
  expect(await storedRows(page)).toEqual(before);
  await page.screenshot({
    path: `test-results/calendar-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dateButton(page, 11).click();
  await preview(page).getByRole("button", { name: "Open day" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This past entry is protected.", { exact: true }),
  ).toBeVisible();
  await nav(page, "Calendar").click();
  await expect(dateButton(page, 11)).toHaveAttribute("aria-pressed", "true");
});

test("saved edits and Life checkoffs update the preview and survive offline reload and reset", async ({
  page,
  context,
}) => {
  await openCalendar(page);
  await preview(page).getByRole("button", { name: "Open day" }).click();
  await page
    .getByRole("group", { name: "Vaped?", exact: true })
    .getByRole("button", { name: "Yes", exact: true })
    .click();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "Calendar").click();
  await expect(
    dateButton(page, 13).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "0");
  await preview(page).getByRole("button", { name: "Open day" }).click();
  await page
    .getByRole("group", { name: "Vaped?", exact: true })
    .getByRole("button", { name: "No", exact: true })
    .click();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "To-do").click();
  const laundry = page.getByRole("checkbox", {
    name: "Complete Do laundry",
    exact: true,
  });
  await laundry.check();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByRole("list", {
      name: "Activities worked on",
      exact: true,
    }),
  ).toContainText("Do laundry");
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toContainText("1 of 15");
  await expect(
    dateButton(page, 13).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "1");
  await nav(page, "Anti-rot").click();
  await page
    .getByRole("button", {
      name: "Did this: Take a walk without headphones",
      exact: true,
    })
    .click();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByRole("list", {
      name: "Activities worked on",
      exact: true,
    }),
  ).toContainText("Take a walk without headphones");
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toContainText("1 of 15");
  await nav(page, "Anti-rot").click();
  await page
    .getByRole("button", {
      name: "Remove today’s log for Take a walk without headphones",
      exact: true,
    })
    .click();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByRole("list", {
      name: "Activities worked on",
      exact: true,
    }),
  ).not.toContainText("Take a walk without headphones");
  await nav(page, "To-do").click();
  await laundry.uncheck();
  await expect(page.locator(".save-state")).toHaveText("Saved on this device");
  await nav(page, "Calendar").click();
  await expect(preview(page)).not.toContainText("Do laundry");
  await expect(preview(page)).toContainText("No activities recorded");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toContainText("1 of 15");
  await dateButton(page, 12).click();
  await expect(
    preview(page).getByRole("list", {
      name: "Activities worked on",
      exact: true,
    }),
  ).toContainText("Return library books");
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await nav(page, "Calendar").click();
  await expect(preview(page)).toContainText("No entries recorded");
  await expect(
    dateButton(page, 13).locator(".calendar-bubble"),
  ).not.toHaveAttribute("data-band");
});

test("calendar follows light and dark mode while score colors ignore palettes", async ({
  page,
}) => {
  await openCalendar(page);
  await dateButton(page, 12).click();
  await expect(dateButton(page, 12)).toHaveCSS(
    "box-shadow",
    "rgb(168, 187, 147) 0px 0px 0px 2px inset",
  );
  async function appearance() {
    return calendar(page).evaluate((root) => {
      const selectors = [
        ".calendar-month",
        ".calendar-preview",
        ".calendar-open",
        ".calendar-date[data-selected]",
        ".calendar-bubble[data-band='3']",
        ".calendar-legend",
      ];
      return selectors.map((selector) => {
        const style = getComputedStyle(root.querySelector(selector)!);
        return [
          style.color,
          style.backgroundColor,
          style.borderColor,
          style.boxShadow,
          style.fontFamily,
        ];
      });
    });
  }
  const dark = await appearance();
  await expect(calendar(page).locator(".calendar-month")).toHaveCSS(
    "background-color",
    "rgb(37, 46, 40)",
  );
  const bubble = await dateButton(page, 12)
    .locator(".calendar-bubble")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("dialog", { name: "Your space" })
    .getByRole("button", { name: "Light", exact: true })
    .click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(calendar(page).locator(".calendar-month")).toHaveCSS(
    "background-color",
    "rgb(247, 244, 236)",
  );
  await expect(dateButton(page, 12)).toHaveCSS(
    "box-shadow",
    "rgb(83, 111, 91) 0px 0px 0px 2px inset",
  );
  await expect(dateButton(page, 12).locator(".calendar-bubble")).toHaveCSS(
    "background-color",
    bubble,
  );
  const light = await appearance();
  // App color palettes do not alter the calendar's own Light/Dark palettes.
  await page.evaluate(() => {
    const root = document.documentElement.dataset;
    root.appPalette = "blue-slate";
    root.antiPalette = "rosewood";
    root.completionPalette = "indigo-amber";
  });
  expect(await appearance()).toEqual(light);
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("dialog", { name: "Your space" })
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dateButton(page, 12)).toHaveCSS(
    "box-shadow",
    "rgb(168, 187, 147) 0px 0px 0px 2px inset",
  );
  expect(await appearance()).toEqual(dark);
  await dateButton(page, 11).focus();
  await page.keyboard.press("Enter");
  await expect(dateButton(page, 11)).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/calendar-narrow-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("private navigation remains unchanged", async ({ page }) => {
  await openPrivateApp(page);
  await expect(nav(page, "Calendar")).toHaveCount(0);
});
