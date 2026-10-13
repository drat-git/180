import { openPrivateApp } from "./private-fixture";
import { test, expect, type Page } from "@playwright/test";
const answer = (page: Page, label: string, value: string) =>
  page
    .getByRole("group", { name: label, exact: true })
    .getByRole("button", { name: value, exact: true });
async function start(page: Page, time: string) {
  await page.clock.install({ time: new Date(time) });
  await openPrivateApp(page);
}
const body = (page: Page) =>
  page.getByRole("region", { name: "Body", exact: true });
const progress = (page: Page) =>
  page.getByLabel("Body checklist progress", { exact: true });
const total = (page: Page) =>
  page.getByLabel("Daily checklist progress", { exact: true });
const saved = (page: Page) =>
  expect(page.locator(".save-state")).toHaveText(
    /^(Sign in to sync|Saved locally · offline)$/,
  );

test("Creatine starts at Day 5's 2 AM boundary without changing earlier checklists or totals", async ({
  page,
}) => {
  await start(page, "2026-10-13T01:59:50-04:00");
  await expect(
    page.getByRole("heading", { name: "Day 4", exact: true }),
  ).toBeVisible();
  await expect(answer(page, "Creatine", "Yes")).toHaveCount(0);
  await expect(progress(page)).toHaveText("0/3 complete");
  await expect(total(page)).toHaveText("0/13 checks complete");
  await answer(page, "Lifted", "Yes").click();
  await saved(page);
  await page.clock.fastForward("00:00:15");
  await expect(
    page.getByRole("heading", { name: "Day 4", exact: true }),
  ).toBeVisible();
  await expect(answer(page, "Creatine", "Yes")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Day 5", exact: true }),
  ).toBeVisible();
  await expect(body(page).locator(".field-label")).toHaveText([
    "AM posture exercises",
    "PM posture exercises",
    "Lifted",
    "Creatine",
  ]);
  await expect(progress(page)).toHaveText("0/4 complete");
  await expect(total(page)).toHaveText("0/14 checks complete");
  await answer(page, "Creatine", "Yes").click();
  await expect(progress(page)).toHaveText("1/4 complete");
  await expect(total(page)).toHaveText("1/14 checks complete");
  await saved(page);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(answer(page, "Creatine", "Yes")).toHaveCount(0);
  await expect(answer(page, "Lifted", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(progress(page)).toHaveText("1/3 complete");
  await expect(total(page)).toHaveText("1/13 checks complete");
});

test("Creatine answers and optional reasons persist offline, minimize, clear, and respect historical protection", async ({
  page,
  context,
}) => {
  await start(page, "2026-10-13T12:00:00-04:00");
  await answer(page, "Creatine", "No").click();
  const reason = page.getByRole("textbox", {
    name: "Creatine reason",
    exact: true,
  });
  await reason.fill("Forgot to take it");
  const field = body(page).locator(".field").last();
  await field.getByRole("button", { name: "Minimize", exact: true }).click();
  await saved(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(answer(page, "Creatine", "No")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(reason).toHaveCount(0);
  await field.getByRole("button", { name: "View reason", exact: true }).click();
  await expect(reason).toHaveValue("Forgot to take it");
  await answer(page, "Creatine", "Yes").click();
  await expect(answer(page, "Creatine", "Yes")).toHaveCSS(
    "background-color",
    "rgb(24, 125, 149)",
  );
  await expect(reason).toHaveCount(0);
  await expect(progress(page)).toHaveText("1/4 complete");
  await answer(page, "Creatine", "Yes").click();
  await expect(answer(page, "Creatine", "Yes")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(progress(page)).toHaveText("0/4 complete");
  await answer(page, "Creatine", "No").click();
  await expect(answer(page, "Creatine", "No")).toHaveCSS(
    "background-color",
    "rgb(154, 90, 130)",
  );
  await expect(reason).toHaveValue("Forgot to take it");
  await field.getByRole("button", { name: "Minimize", exact: true }).click();
  await page
    .getByRole("button", { name: "Minimize Body", exact: true })
    .click();
  await expect(progress(page)).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Maximize Body", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Maximize Body", exact: true })
    .click();
  await expect(reason).toHaveCount(0);
  await body(page).screenshot({
    path: `test-results/private-screenshots/180-creatine-${test.info().project.name}.png`,
  });
  await page.clock.setSystemTime(new Date("2026-10-15T12:00:00-04:00"));
  await page.reload();
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("button", { name: "Previous day", exact: true })
      .click();
  await answer(page, "Creatine", "Yes").click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Anyway", exact: true }).click();
  await expect(answer(page, "Creatine", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(progress(page)).toHaveText("1/4 complete");
});
