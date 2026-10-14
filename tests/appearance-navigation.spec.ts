import { openPrivateApp } from "./private-fixture";
import { test, expect } from "@playwright/test";
test("separate tabs preserve drafts and settings clearly select soft dark mode", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00-04:00") });
  await openPrivateApp(page);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("button")).toHaveText([
    "Today",
    "To-do",
    "Anti-rot",
    "Calendar",
  ]);
  await expect(
    page.getByRole("heading", { name: "Daily checklist", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    page.getByText(
      "“Every action you take is a vote for the type of person you wish to become.” - James Clear",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New school task" })
    .fill("Draft homework");
  await expect(
    page.getByRole("button", { name: "Add activity", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Anti-rot", exact: true }).click();
  await page.getByRole("button", { name: "Add activity", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Activity title", exact: true })
    .fill("Draft idea");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await nav.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "New school task" }),
  ).toHaveValue("Draft homework");
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  const space = page.getByRole("dialog", { name: "Your space" });
  await expect(
    space.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await space.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(
    space.getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
  ).toBe("rgb(41, 47, 44)");
  await expect(
    space.getByRole("button", { name: "Enable reminders" }),
  ).toBeDisabled(); // Offline private fixtures cannot register production pushes.
  await page.screenshot({
    path: `test-results/private-screenshots/180-your-space-dark-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await nav
    .getByRole("button", { name: "Show daily checklist", exact: true })
    .click();
  await page
    .getByRole("group", { name: "AM posture exercises", exact: true })
    .getByRole("button", { name: "Yes", exact: true })
    .click();
  await page.screenshot({
    path: `test-results/private-screenshots/180-dark-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(page.locator(".yesterday-note")).toHaveCSS(
    "color",
    "rgb(229, 161, 95)",
  );
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await space.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("a reminder opens Today from another tab and an older date", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00-04:00") });
  await openPrivateApp(page);
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "OPEN_TODAY" } }),
    ),
  );
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Show daily checklist" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Day 4", exact: true }),
  ).toBeVisible();
});
