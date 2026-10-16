import { openPrivateApp } from "./private-fixture";
import { expandAppearance } from "./appearance-fixture";
import { test, expect } from "@playwright/test";

for (const mode of ["demo", "private"] as const) {
  test(`${mode} screen edit shortcuts open the matching editors and preserve To-do drafts`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-15T12:00:00-04:00") });
    if (mode === "private") await openPrivateApp(page);
    else {
      await page.goto("/");
      await page
        .getByRole("button", { name: "Try the demo mode", exact: true })
        .click();
    }
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const dailyEdit = page.getByRole("button", {
      name: "Edit daily checklist",
      exact: true,
    });
    await dailyEdit.scrollIntoViewIfNeeded();
    const dailyHeading = await page
      .getByRole("heading", { name: "Daily checklist", exact: true })
      .boundingBox();
    const dailyButton = await dailyEdit.boundingBox();
    expect(
      Math.abs(
        dailyButton!.y +
          dailyButton!.height / 2 -
          dailyHeading!.y -
          dailyHeading!.height / 2,
      ),
    ).toBeLessThan(2);
    expect(dailyButton!.x).toBeGreaterThan(
      dailyHeading!.x + dailyHeading!.width,
    );
    const firstBlock = await page
      .locator(".checkin-card .checklist-block")
      .first()
      .boundingBox();
    expect(dailyButton!.y + dailyButton!.height).toBeLessThanOrEqual(
      firstBlock!.y,
    );
    await page.screenshot({
      path: `test-results/checklist-edit-shortcut-${mode}-${test.info().project.name}.png`,
    });
    await dailyEdit.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Edit Daily Checklist", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Edit Daily Checklist", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await expect(
      nav.getByRole("button", { name: "Show daily checklist" }),
    ).toHaveAttribute("aria-pressed", "true");

    await nav.getByRole("button", { name: "To-do", exact: true }).click();
    const draft = page.getByRole("textbox", {
      name: "New school task",
      exact: true,
    });
    await draft.fill("Keep my unfinished task draft");
    const listsEdit = page.getByRole("button", {
      name: "Edit To-Do lists",
      exact: true,
    });
    await listsEdit.scrollIntoViewIfNeeded();
    const todoHeading = await page
      .getByRole("heading", { name: "To-do", exact: true })
      .boundingBox();
    const todoButton = await listsEdit.boundingBox();
    expect(
      Math.abs(
        todoButton!.y +
          todoButton!.height / 2 -
          todoHeading!.y -
          todoHeading!.height / 2,
      ),
    ).toBeLessThan(2);
    expect(todoButton!.x).toBeGreaterThan(todoHeading!.x + todoHeading!.width);
    await page.screenshot({
      path: `test-results/todo-edit-shortcut-${mode}-${test.info().project.name}.png`,
    });
    await listsEdit.click();
    await expect(
      page.getByRole("dialog", { name: "Edit To-Do lists", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Edit To-Do lists", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await expect(
      nav.getByRole("button", { name: "To-do", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(draft).toHaveValue("Keep my unfinished task draft");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

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
    space.getByRole("heading", { name: "Edit your lists", exact: true }),
  ).toBeVisible();
  const checklistButton = space.getByRole("button", {
    name: "Edit Daily Checklist",
    exact: true,
  });
  const listsButton = space.getByRole("button", {
    name: "Edit To-Do lists",
    exact: true,
  });
  const checklistBox = await checklistButton.boundingBox();
  const listsBox = await listsButton.boundingBox();
  expect(checklistBox!.height).toBeGreaterThanOrEqual(48);
  expect(listsBox!.height).toBeGreaterThanOrEqual(48);
  expect(listsBox!.y).toBeGreaterThanOrEqual(
    checklistBox!.y + checklistBox!.height,
  );
  expect(listsBox!.width).toBeCloseTo(checklistBox!.width, 0);
  await expect(
    space.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await expect(
    space.getByRole("group", { name: "Mode", exact: true }),
  ).not.toBeVisible();
  await space.screenshot({
    path: `test-results/your-space-collapsed-${test.info().project.name}.png`,
  });
  await space.locator(".appearance-settings > summary").focus();
  await page.keyboard.press("Enter");
  await expect(
    space.getByRole("group", { name: "Mode", exact: true }),
  ).toBeVisible();
  await space.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(
    space.getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await space.locator(".appearance-settings > summary").click();
  await expect(
    space.getByRole("button", { name: "Dark", exact: true }),
  ).not.toBeVisible();
  await expandAppearance(page);
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
  await expect(
    space.getByRole("group", { name: "Mode", exact: true }),
  ).not.toBeVisible();
  await expandAppearance(page);
  await space.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await space
    .getByRole("button", { name: "Edit Daily Checklist", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit Daily Checklist", exact: true }),
  ).toBeVisible();
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
