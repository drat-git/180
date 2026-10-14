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
  ).toHaveText("9 of 13 checks complete");
  await expect(
    dateButton(page, 11).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "3");
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
  ).toHaveText("13 of 15 checks complete");
  await expect(
    dateButton(page, 12).locator(".calendar-bubble"),
  ).toHaveAttribute("data-band", "4");
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

test("past-day header progress matches calendar colors while Today keeps its neutral bubble", async ({
  page,
}) => {
  await openCalendar(page);
  const progress = page.getByLabel("Daily checklist progress", { exact: true });
  for (const mode of ["dark", "light"]) {
    for (const palette of ["classic", "forest-rust", "indigo-amber"]) {
      await page.evaluate(
        ({ mode, palette }) => {
          document.documentElement.dataset.theme = mode;
          document.documentElement.dataset.completionPalette = palette;
        },
        { mode, palette },
      );
      for (const day of [11, 12]) {
        await nav(page, "Calendar").click();
        await dateButton(page, day).click();
        const bubble = dateButton(page, day).locator(".calendar-bubble");
        const color = await bubble.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        const band = await bubble.getAttribute("data-band");
        await preview(page).getByRole("button", { name: "Open day" }).click();
        await expect(progress).toHaveAttribute("data-band", band!);
        await expect(progress).toHaveCSS("background-color", color);
        await expect(progress).toHaveCSS("color", "rgb(255, 255, 255)");
      }
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(progress).not.toHaveAttribute("data-band");
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.completionPalette = "classic";
  });
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await page.locator(".day-header").screenshot({
    path: `test-results/past-day-progress-${test.info().project.name}.png`,
  });
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

test("calendar surfaces follow light and dark mode independently of app palettes", async ({
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
  await expect(dateButton(page, 12).locator(".calendar-bubble")).not.toHaveCSS(
    "background-color",
    bubble,
  );
  const light = await appearance();
  // App and Anti-rot palettes do not alter the calendar's surfaces or scores.
  await page.evaluate(() => {
    const root = document.documentElement.dataset;
    root.appPalette = "blue-slate";
    root.antiPalette = "rosewood";
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

test("calendar gradients follow completion choices in both modes without changing records", async ({
  page,
}) => {
  await openCalendar(page);
  await dateButton(page, 12).click();
  const before = await storedRows(page);
  const label = await dateButton(page, 12).getAttribute("aria-label");
  const palettes = [
    {
      name: "Classic",
      light: ["9a5a82", "187d95"],
      dark: ["975579", "287f94"],
    },
    {
      name: "Forest & Rust",
      light: ["b34f46", "2d7557"],
      dark: ["b2544c", "357b60"],
    },
    {
      name: "Indigo & Amber",
      light: ["5357ad", "a1651e"],
      dark: ["6064b5", "9b6520"],
    },
  ];
  const channels = (hex: string) =>
    hex.match(/../g)!.map((n) => parseInt(n, 16));
  const luminance = (rgb: number[]) =>
    rgb.reduce((sum, value, i) => {
      const n = value / 255;
      return (
        sum +
        (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  for (const mode of ["light", "dark"] as const) {
    for (const palette of palettes) {
      await page
        .getByRole("button", { name: "Account and app information" })
        .click();
      const settings = page.getByRole("dialog", {
        name: "Your space",
        exact: true,
      });
      await settings
        .getByRole("group", { name: "Mode", exact: true })
        .getByRole("button", {
          name: mode === "light" ? "Light" : "Dark",
          exact: true,
        })
        .click();
      await settings
        .getByRole("group", { name: "Completion colors", exact: true })
        .getByRole("button", { name: palette.name, exact: true })
        .click();
      await settings
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      const colors = await calendar(page).evaluate((root) => {
        // Normalize both rgb() and color-mix() computed values to actual pixels.
        const context = document.createElement("canvas").getContext("2d")!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const bands = Array.from(
          root.querySelectorAll(".calendar-legend i[data-band]"),
        ).map((element) => rgba(getComputedStyle(element).backgroundColor));
        const bubble = root.querySelector(".calendar-bubble[data-band='4']")!;
        const empty = root.querySelector(".calendar-bubble:not([data-band])")!;
        return {
          bands,
          bubble: rgba(getComputedStyle(bubble).backgroundColor),
          text: rgba(getComputedStyle(bubble).color),
          empty: rgba(getComputedStyle(empty).backgroundColor),
        };
      });
      const [low, high] = palette[mode].map(channels);
      expect(colors.bands).toHaveLength(6);
      for (const [band, color] of colors.bands.entries()) {
        const fraction = band / 5;
        color.slice(0, 3).forEach((channel, i) => {
          expect(
            Math.abs(
              channel -
                Math.round(low[i] * (1 - fraction) + high[i] * fraction),
            ),
          ).toBeLessThanOrEqual(1);
        });
        expect(color[3]).toBe(255);
        expect(
          (luminance(colors.text.slice(0, 3)) + 0.05) /
            (luminance(color.slice(0, 3)) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(colors.bubble).toEqual(colors.bands[4]);
      expect(colors.empty[3]).toBe(0);
      await expect(dateButton(page, 12)).toHaveAttribute("aria-label", label!);
      await expect(
        dateButton(page, 12).locator(".calendar-bubble"),
      ).toHaveAttribute("data-band", "4");
    }
  }
  expect(await storedRows(page)).toEqual(before);
  await page.screenshot({
    path: `test-results/calendar-completion-palette-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("main calendar uses private records and rules, preserves protected history and works offline", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-10-14T12:00:00-04:00") });
  await openPrivateApp(page);
  await page.getByLabel("Wake-up time", { exact: true }).fill("09:10");
  await page
    .getByRole("group", { name: "Used cannabis?", exact: true })
    .getByRole("button", { name: "Yes", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("Main account journal");
  await expect(page.locator(".save-state")).toHaveText("Sign in to sync");
  const before = await storedRows(page);
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("2 of 14 checks complete");
  await expect(dateButton(page, 8)).toBeDisabled();
  await expect(dateButton(page, 9)).toBeEnabled();
  await expect(dateButton(page, 15)).toBeDisabled();
  await expect(preview(page)).not.toContainText("Return library books");
  await dateButton(page, 9).click();
  await expect(preview(page)).toContainText("DAY 1");
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("0 of 13 checks complete");
  await preview(page).getByRole("button", { name: "Open day" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This past entry is protected.", { exact: true }),
  ).toBeVisible();
  await nav(page, "Calendar").click();
  await expect(dateButton(page, 9)).toHaveAttribute("aria-pressed", "true");
  expect(await storedRows(page)).toEqual(before);
  await calendar(page)
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("2 of 14 checks complete");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("Main account journal");
  await nav(page, "Calendar").click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("2 of 14 checks complete");
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/main-calendar-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("main calendar follows the real 2 AM rollover across month boundaries", async ({
  page,
}) => {
  // Fall-back Sunday repeats 1 AM; the day changes after the second 1:59 AM.
  await page.clock.install({ time: new Date("2026-11-01T01:59:50-05:00") });
  await openPrivateApp(page);
  await page.getByLabel("Wake-up time", { exact: true }).fill("09:10");
  await expect(page.locator(".save-state")).toHaveText("Sign in to sync");
  await nav(page, "Calendar").click();
  await expect(
    calendar(page).getByRole("heading", { name: "October 2026", exact: true }),
  ).toBeVisible();
  await expect(preview(page)).toContainText("DAY 23 · IN PROGRESS");
  await expect(
    calendar(page).getByRole("button", { name: "Next month" }),
  ).toBeDisabled();
  await page.clock.fastForward("00:00:15");
  await expect(preview(page)).toContainText("DAY 23 · DAILY RECORD");
  await expect(
    calendar(page).getByRole("button", { name: "Next month" }),
  ).toBeEnabled();
  await calendar(page)
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await expect(
    calendar(page).getByRole("heading", { name: "November 2026", exact: true }),
  ).toBeVisible();
  await expect(preview(page)).toContainText("DAY 24 · IN PROGRESS");
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("0 of 13 checks complete");
  await calendar(page).getByRole("button", { name: "Previous month" }).click();
  await dateButton(page, 31).click();
  await expect(
    preview(page).getByLabel("Calendar checklist progress"),
  ).toHaveText("1 of 13 checks complete");
  await preview(page).getByRole("button", { name: "Open day" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 23", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".yesterday-note")).toBeVisible();
});
