import { test, expect, type Page } from "@playwright/test";
const original = "AM Shake/Calorie-Dense Breakfast";
const answer = (page: Page, label: string, value: string) =>
  page
    .getByRole("group", { name: label, exact: true })
    .getByRole("button", { name: value, exact: true });
async function start(page: Page, time = "2026-10-12T12:00:00-04:00") {
  await page.clock.install({ time: new Date(time) });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the local preview" }).click();
}
const saved = (page: Page) =>
  expect(page.locator(".save-state")).toContainText("Saved on this device");
const food = (page: Page) =>
  page.getByRole("region", { name: "Food", exact: true });

test("Day 4 food requires an AM choice, resets it, and preserves hidden text offline", async ({
  page,
  context,
}) => {
  await start(page);
  await expect(food(page).locator(".field-label")).toHaveText([
    original,
    "Lunch",
    "Dinner",
    "PM Shake",
    "SnackFruit, protein bar, boba, etc",
  ]);
  const progress = page.getByLabel("Food checklist progress", { exact: true });
  await answer(page, original, "Yes").click();
  await expect(
    page.getByRole("radio", { name: "AM shake", exact: true }),
  ).toBeVisible();
  await expect(progress).toHaveText("0/5 complete");
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Calorie dense meal", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "AM shake", exact: true }).click();
  await expect(answer(page, "AM shake", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(food(page).getByRole("textbox")).toHaveCount(0);
  await expect(progress).toHaveText("1/5 complete");
  await answer(page, "AM shake", "Yes").click();
  await expect(answer(page, original, "Yes")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await answer(page, original, "Yes").click();
  await page
    .getByRole("radio", { name: "Calorie dense meal", exact: true })
    .click();
  const breakfast = page.getByRole("textbox", {
    name: "Calorie dense meal food description",
    exact: true,
  });
  await expect(breakfast).toBeVisible();
  await breakfast.fill("Eggs, avocado, and toast");
  const amField = food(page).locator(".field").first();
  await amField.getByRole("button", { name: "Minimize", exact: true }).click();
  await answer(page, "Calorie dense meal", "No").click();
  await page
    .getByRole("textbox", { name: `${original} reason`, exact: true })
    .fill("Had a late start");
  await answer(page, original, "Yes").click();
  await page.getByRole("radio", { name: "AM shake", exact: true }).click();
  await expect(breakfast).toHaveCount(0);
  await answer(page, "AM shake", "Yes").click();
  await answer(page, original, "Yes").click();
  await page
    .getByRole("radio", { name: "Calorie dense meal", exact: true })
    .click();
  await expect(breakfast).toHaveCount(0);
  await amField
    .getByRole("button", { name: "View food description", exact: true })
    .click();
  await expect(breakfast).toHaveValue("Eggs, avocado, and toast");
  for (const label of ["Lunch", "Dinner", "PM Shake", "Snack"])
    await answer(page, label, "Yes").click();
  await page
    .getByRole("textbox", { name: "Snack food description", exact: true })
    .fill("Fruit and a protein bar");
  await expect(progress).toHaveText("5/5 complete");
  await amField.getByRole("button", { name: "Minimize", exact: true }).click();
  await saved(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(answer(page, "Calorie dense meal", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(progress).toHaveText("5/5 complete");
  await expect(breakfast).toHaveCount(0);
  await amField
    .getByRole("button", { name: "View food description", exact: true })
    .click();
  await expect(breakfast).toHaveValue("Eggs, avocado, and toast");
  await expect(
    page.getByRole("textbox", { name: "Snack food description", exact: true }),
  ).toHaveValue("Fruit and a protein bar");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await food(page).screenshot({
    path: `artifacts/180-food-day-four-${test.info().project.name}.png`,
  });
});

test("Days 1–3 retain their original food fields, counts, and saved records across the cutoff", async ({
  page,
}) => {
  await start(page, "2026-10-11T12:00:00-04:00");
  const legacy = ["Meal 1", "Meal 2", "Snack 1", "Snack 2", "Bulking shake"];
  await expect(food(page).locator(".field-label")).toHaveText(legacy);
  for (const label of legacy) await answer(page, label, "Yes").click();
  await page
    .getByRole("textbox", { name: "Snack 2 food description", exact: true })
    .fill("Original second snack");
  await saved(page);
  const recorded = () =>
    page.evaluate(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = indexedDB.open("180-private");
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction("entries")
              .objectStore("entries")
              .getAll();
            read.onsuccess = () => {
              resolve(
                read.result.filter(
                  (entry) => entry.logicalDate === "2026-10-11",
                ),
              );
              db.close();
            };
            read.onerror = () => {
              reject(read.error);
              db.close();
            };
          };
          request.onerror = () => reject(request.error);
        }),
    );
  const before = await recorded();
  expect(before).toHaveLength(1);
  await page.clock.setSystemTime(new Date("2026-10-12T12:00:00-04:00"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Day 4", exact: true }),
  ).toBeVisible();
  await expect(answer(page, original, "Yes")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    page.getByLabel("Food checklist progress", { exact: true }),
  ).toHaveText("0/5 complete");
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(food(page).locator(".field-label")).toHaveText(legacy);
  await expect(
    page.getByRole("textbox", {
      name: "Snack 2 food description",
      exact: true,
    }),
  ).toHaveValue("Original second snack");
  await expect(
    page.getByLabel("Food checklist progress", { exact: true }),
  ).toHaveText("5/5 complete");
  expect(await recorded()).toEqual(before);
  for (let day = 2; day >= 1; day--) {
    await page
      .getByRole("button", { name: "Previous day", exact: true })
      .click();
    await expect(food(page).locator(".field-label")).toHaveText(legacy);
  }
  await answer(page, "Snack 1", "Yes").click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Anyway", exact: true }).click();
  await expect(answer(page, "Snack 1", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(answer(page, original, "Yes")).toHaveCount(0);
});
