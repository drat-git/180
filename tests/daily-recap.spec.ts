import { expect, test, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

const recap = (page: Page) =>
  page.getByRole("region", { name: "Daily activity recap", exact: true });
const checklist = (page: Page) =>
  page.getByRole("button", { name: "Show daily checklist", exact: true });
async function addLife(page: Page, title: string, parent?: string) {
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
      name: parent ? "New subtask" : "New life task",
      exact: true,
    })
    .fill(title);
  await page
    .getByRole("button", {
      name: parent ? "Add subtask" : "Add life task",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", {
      name: parent ? "Add subtask options" : "Add task options",
      exact: true,
    })
    .getByRole("button", {
      name: parent ? "Add subtask" : "Add task",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("checkbox", { name: `Complete ${title}`, exact: true }),
  ).toBeVisible();
}

test("demo Life completions precede anti-rot activities in a headerless recap across palettes", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await expect(recap(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  const block = recap(page);
  await expect(block.locator(".anti-recap > li")).toHaveCount(3);
  await expect(block.locator(".anti-recap > li").nth(0)).toContainText(
    "Return library books",
  );
  await expect(block.locator(".anti-recap > li").nth(1)).toContainText(
    "Watch a public lecture about space",
  );
  await expect(block.locator(".anti-recap > li").nth(2)).toContainText(
    "Practice guitar for 15 minutes",
  );
  await expect(block.locator(".anti-recap > li").nth(1)).toHaveClass(
    "recap-anti-start",
  );
  await expect(block.locator(".recap-anti-start")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  await expect(
    block.locator(".anti-recap > li").nth(2).locator(".anti-status"),
  ).toHaveCount(0);
  await expect(block.getByText("Completed", { exact: true })).toHaveCount(2);
  await expect(block.getByRole("heading")).toHaveCount(0);
  await expect(block.locator(".block-heading, .block-icon")).toHaveCount(0);
  await expect(block.getByRole("button")).toHaveCount(0);
  await expect(block.getByRole("checkbox")).toHaveCount(0);
  for (const mode of ["Light", "Dark"])
    for (const palette of ["Classic", "Sunset", "Rosewood"]) {
      await page
        .getByRole("button", {
          name: "Account and app information",
          exact: true,
        })
        .click();
      const settings = page.getByRole("dialog", {
        name: "Your space",
        exact: true,
      });
      await settings
        .getByRole("group", { name: "Mode", exact: true })
        .getByRole("button", { name: mode, exact: true })
        .click();
      await settings
        .getByRole("group", { name: "Anti-rot colors", exact: true })
        .getByRole("button", { name: palette, exact: true })
        .click();
      await settings
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      const colors = await page.evaluate(() => {
        const past = getComputedStyle(
          document.querySelector(
            '[aria-label="Daily activity recap"].checklist-block',
          )!,
        );
        const active = getComputedStyle(
          document.querySelector(
            '[data-block="Things to do instead of scrolling"]',
          )!,
        );
        return {
          past: past.backgroundColor,
          active: active.backgroundColor,
          border: past.borderColor,
          activeBorder: active.borderColor,
        };
      });
      expect(colors.past).toBe(colors.active);
      expect(colors.border).toBe(colors.activeBorder);
      await expect(
        page.getByLabel("Daily checklist progress", { exact: true }),
      ).toHaveText("10/15 checks complete");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  await block.screenshot({
    path: `test-results/daily-recap-combined-${test.info().project.name}.png`,
  });
});

test("private Life-only recap groups completed children, survives archive and works offline", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00-04:00") });
  await openPrivateApp(page);
  const before = await page
    .getByLabel("Daily checklist progress", { exact: true })
    .textContent();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  const parent = "Prepare for moving across campus after the semester";
  await addLife(page, parent);
  await addLife(page, "Pack books", parent);
  await addLife(page, "Pack clothes", parent);
  await page
    .getByRole("checkbox", { name: "Complete Pack books", exact: true })
    .check();
  await addLife(page, "Return library books");
  await page
    .getByRole("checkbox", {
      name: "Complete Return library books",
      exact: true,
    })
    .check();
  await checklist(page).click();
  await expect(recap(page)).toHaveCount(0);
  await page.clock.fastForward("24:00:01");
  const block = recap(page);
  await expect(block).toBeVisible();
  await expect(block.locator(".recap-anti-start")).toHaveCount(0);
  await expect(block.locator(".anti-recap > li")).toHaveCount(2);
  const group = block.locator(".life-recap-group").first();
  await expect(group.locator(".recap-row")).toHaveText(parent);
  await expect(group.locator(".recap-row .anti-status")).toHaveCount(0);
  await expect(
    group.getByRole("list", {
      name: `Completed subtasks of ${parent}`,
      exact: true,
    }),
  ).toHaveText("Pack booksCompleted");
  await expect(block.getByText("Pack clothes", { exact: true })).toHaveCount(0);
  await expect(block.locator(".block-heading")).toHaveCount(0);
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText(before!);
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Task Return library books", exact: true }),
  ).toHaveCount(0);
  // Reopening a child today must not erase yesterday's accomplishment.
  await page
    .getByRole("checkbox", { name: "Complete Pack books", exact: true })
    .uncheck();
  await checklist(page).click();
  await expect(block.getByText("Pack books", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(recap(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(block.getByText("Pack books", { exact: true })).toBeVisible();
  await expect(
    block.getByText("Return library books", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await block.screenshot({
    path: `test-results/daily-recap-life-only-${test.info().project.name}.png`,
  });
});

test("a same-day Life completion undo leaves no past-day recap", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00-04:00") });
  await openPrivateApp(page);
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await addLife(page, "Pick up groceries");
  const checkbox = page.getByRole("checkbox", {
    name: "Complete Pick up groceries",
    exact: true,
  });
  await checkbox.check();
  await checkbox.uncheck();
  await checklist(page).click();
  await page.clock.fastForward("24:00:01");
  await expect(recap(page)).toHaveCount(0);
});
