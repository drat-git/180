import { test, expect } from "@playwright/test";
test("compact notes grow for text and correctly resize after returning from Do Stuff", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-10T12:00:00-04:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the local preview" }).click();
  await page
    .getByRole("group", { name: "Meal 1", exact: true })
    .getByRole("button", { name: "No", exact: true })
    .click();
  const reason = page.getByRole("textbox", {
    name: "Meal 1 reason",
    exact: true,
  });
  const empty = (await reason.boundingBox())!.height;
  expect(empty).toBeLessThan(55);
  const value = "A bit of context.\nSecond line.\nThird line.\nFourth line.";
  await reason.fill(value);
  await expect(reason).toHaveValue(value);
  expect((await reason.boundingBox())!.height).toBeGreaterThan(empty);
  await page.getByRole("button", { name: "Do Stuff", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole("button", { name: "Show daily check-in" }).click();
  await expect(reason).toHaveValue(value);
  expect(
    await reason.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true);
  await reason.fill("");
  expect((await reason.boundingBox())!.height).toBeLessThan(55);
  const journal = page.getByRole("textbox", {
    name: "Daily journal",
    exact: true,
  });
  const journalEmpty = (await journal.boundingBox())!.height;
  expect(journalEmpty).toBeLessThan(180);
  await journal.fill(
    Array.from(
      { length: 12 },
      (_, i) => `Line ${i + 1}: a quiet daily record.`,
    ).join("\n"),
  );
  expect((await journal.boundingBox())!.height).toBeGreaterThan(journalEmpty);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
