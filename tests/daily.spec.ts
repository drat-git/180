import { test, expect } from "@playwright/test";
const blockOrder = ["General", "School", "Career", "Food", "Body"];
async function preview(
  page: import("@playwright/test").Page,
  time = "2026-10-12T12:00:00-04:00",
  day = 4,
) {
  await page.clock.install({ time: new Date(time) });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the local preview" }).click();
  await expect(
    page.getByRole("heading", { name: `Day ${day}.` }),
  ).toBeVisible();
}
const answer = (
  page: import("@playwright/test").Page,
  label: string,
  value: string,
) =>
  page
    .getByRole("group", { name: label, exact: true })
    .getByRole("button", { name: value, exact: true });
test("answers, reasons, food descriptions and text survive an offline reload", async ({
  page,
  context,
}) => {
  await preview(page);
  await answer(page, "Meal 1", "No").click();
  await page
    .getByRole("textbox", { name: "Meal 1 reason" })
    .fill("Forgot groceries");
  await answer(page, "Meal 1", "Yes").click();
  await page
    .getByRole("textbox", { name: "Meal 1 food description" })
    .fill("Rice and eggs");
  await answer(page, "Meal 1", "No").click();
  await expect(
    page.getByRole("textbox", { name: "Meal 1 reason" }),
  ).toHaveValue("Forgot groceries");
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("A small but good day.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("A small but good day.");
  await expect(
    page.getByRole("textbox", { name: "Meal 1 reason" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "View reason", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Meal 1 reason" }),
  ).toHaveValue("Forgot groceries");
  await answer(page, "Meal 1", "Yes").click();
  await expect(
    page.getByRole("textbox", { name: "Meal 1 food description" }),
  ).toHaveValue("Rice and eggs");
  await answer(page, "Meal 1", "Yes").click();
  await expect(answer(page, "Meal 1", "Yes")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(answer(page, "Meal 1", "No")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
test("weekends omit class and older edits ask once per visit", async ({
  page,
}) => {
  await preview(page);
  await expect(
    page.getByRole("group", { name: "Attended class" }),
  ).toBeVisible();
  await expect(page.locator(".block-heading h3")).toHaveText(blockOrder);
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(
    page.getByRole("region", { name: "School", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".block-heading h3")).toHaveText(
    blockOrder.filter((title) => title !== "School"),
  );
  await expect(page.getByRole("group", { name: "Attended class" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Yesterday’s entry is still freely editable."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(
    page.getByRole("region", { name: "School", exact: true }),
  ).toHaveCount(0);
  await answer(page, "Lifted", "Yes").click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Anyway" }).click();
  await expect(answer(page, "Lifted", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await answer(page, "Meal 1", "Yes").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await answer(page, "Lifted", "No").click();
  await expect(
    page.getByRole("dialog", { name: "Edit past entry?" }),
  ).toBeVisible();
});
test("rollover retains the open journal and updates today navigation", async ({
  page,
}) => {
  await preview(page, "2026-10-12T01:59:50-04:00", 3);
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .fill("Late-night thoughts");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.clock.fastForward("00:00:15");
  await expect(page.getByRole("heading", { name: "Day 3." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("Late-night thoughts");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Day 4." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toHaveValue("");
});
test("thresholds and counters behave at exact boundaries", async ({ page }) => {
  await preview(page);
  await page.getByLabel("Wake-up time", { exact: true }).fill("10:00");
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(0);
  await page.getByLabel("Wake-up time", { exact: true }).fill("10:01");
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(1);
  await page.getByLabel("Wake-up time", { exact: true }).fill("09:00");
  await page.getByLabel("Screen time hours").fill("3");
  await page.getByLabel("Screen time minutes").fill("30");
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(0);
  await page.getByLabel("Screen time minutes").fill("31");
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(1);
  await answer(page, "Used cannabis?", "Yes").click();
  await expect(
    page.getByRole("button", { name: "Decrease how many times?" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Increase how many times?" }).click();
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Increase how many times?" }).click();
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(1);
  await expect(
    page.getByRole("textbox", {
      name: "Cannabis use 3 description",
      exact: true,
    }),
  ).toBeVisible();
});
test("multiple journal photos survive reload and individual removal", async ({
  page,
}) => {
  await preview(page);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("#journal-upload").setInputFiles([
    { name: "page-one.png", mimeType: "image/png", buffer: png },
    { name: "page-two.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toHaveCount(2);
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove journal photo" })
    .first()
    .click();
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "View journal photo" }),
  ).toHaveCount(1);
});
test("every food description minimizes and reopens without losing its text", async ({
  page,
}) => {
  await preview(page);
  for (const label of ["Meal 1", "Meal 2", "Snack 1", "Snack 2"]) {
    await answer(page, label, "Yes").click();
    const field = page
      .locator(".field")
      .filter({ has: page.getByRole("group", { name: label, exact: true }) });
    const input = page.getByRole("textbox", {
      name: `${label} food description`,
    });
    await input.fill(`${label} food`);
    await field.getByRole("button", { name: "Minimize", exact: true }).click();
    await expect(input).toHaveCount(0);
    await field.getByRole("button", { name: "View food description" }).click();
    await expect(input).toHaveValue(`${label} food`);
    await field.getByRole("button", { name: "Minimize", exact: true }).click();
  }
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  for (const label of ["Meal 1", "Meal 2", "Snack 1", "Snack 2"]) {
    const field = page
      .locator(".field")
      .filter({ has: page.getByRole("group", { name: label, exact: true }) });
    await expect(
      page.getByRole("textbox", { name: `${label} food description` }),
    ).toHaveCount(0);
    await field.getByRole("button", { name: "View food description" }).click();
    await expect(
      page.getByRole("textbox", { name: `${label} food description` }),
    ).toHaveValue(`${label} food`);
  }
});
test("cannabis descriptions minimize together and survive count changes and offline reload", async ({
  page,
  context,
}) => {
  await preview(page, "2026-10-09T12:00:00-04:00", 1);
  await answer(page, "Meal 1", "Yes").click();
  await page
    .getByRole("textbox", { name: "Meal 1 food description" })
    .fill("Example meal");
  await answer(page, "Used cannabis?", "Yes").click();
  const more = page.getByRole("button", { name: "Increase how many times?" });
  const less = page.getByRole("button", { name: "Decrease how many times?" });
  await more.click();
  await more.click();
  for (let n = 1; n <= 3; n++) {
    await page
      .getByRole("textbox", { name: `Cannabis use ${n} description` })
      .fill(`Example use ${n}`);
  }
  const field = page.locator(".field").filter({
    has: page.getByRole("group", { name: "Used cannabis?", exact: true }),
  });
  await field.getByRole("button", { name: "Minimize", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Cannabis use/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("textbox", { name: / reason$/ })).toHaveCount(0);
  await more.click();
  await expect(page.getByRole("textbox", { name: /Cannabis use/ })).toHaveCount(
    0,
  );
  await less.click();
  await field.getByRole("button", { name: "View use descriptions" }).click();
  await page.screenshot({
    path: `artifacts/180-description-update-${test.info().project.name}.png`,
    fullPage: true,
  });
  await field.screenshot({
    path: `artifacts/180-cannabis-descriptions-${test.info().project.name}.png`,
  });
  await less.click();
  await less.click();
  await expect(
    page.getByRole("textbox", { name: "Cannabis use 3 description" }),
  ).toHaveCount(0);
  await more.click();
  await more.click();
  await expect(
    page.getByRole("textbox", { name: "Cannabis use 3 description" }),
  ).toHaveValue("Example use 3");
  await answer(page, "Used cannabis?", "No").click();
  await answer(page, "Used cannabis?", "Yes").click();
  await expect(
    page.getByRole("textbox", { name: "Cannabis use 2 description" }),
  ).toHaveValue("Example use 2");
  await expect(page.locator(".save-state")).toContainText(
    "Saved on this device",
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  for (let n = 1; n <= 3; n++) {
    await expect(
      page.getByRole("textbox", { name: `Cannabis use ${n} description` }),
    ).toHaveValue(`Example use ${n}`);
  }
});
test("layout fits the viewport and focusable controls stay reachable", async ({
  page,
}) => {
  await preview(page, "2026-10-09T12:00:00-04:00", 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("textbox", { name: "Daily journal", exact: true })
    .focus();
  await expect(
    page.getByRole("textbox", { name: "Daily journal", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/180-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `artifacts/180-checklist-blocks-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("blocks and text stay minimized through reloads, app reopening, and day changes", async ({
  page,
  context,
}) => {
  await preview(page);
  await expect(page.locator(".block-heading h3")).toHaveText(blockOrder);
  const food = page.getByRole("region", { name: "Food", exact: true });
  const body = page.getByRole("region", { name: "Body", exact: true });
  const general = page.getByRole("region", { name: "General", exact: true });
  const school = page.getByRole("region", { name: "School", exact: true });
  const career = page.getByRole("region", { name: "Career", exact: true });
  await expect(
    school.getByRole("group", { name: "Attended class", exact: true }),
  ).toBeVisible();
  await expect(
    career.getByRole("group", {
      name: "Applied to jobs or internships?",
      exact: true,
    }),
  ).toBeVisible();
  for (const title of blockOrder)
    await expect(
      page.getByRole("button", { name: `Minimize ${title}`, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  await answer(page, "Attended class", "Yes").click();
  await answer(page, "Applied to jobs or internships?", "Yes").click();
  await career
    .getByRole("button", { name: "Increase how many applications?" })
    .click();
  for (const label of [
    "Meal 1",
    "Meal 2",
    "Snack 1",
    "Snack 2",
    "Bulking shake",
  ])
    await expect(
      food.getByRole("group", { name: label, exact: true }),
    ).toBeVisible();
  for (const label of [
    "AM posture exercises",
    "PM posture exercises",
    "Lifted",
  ])
    await expect(
      body.getByRole("group", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    general.getByLabel("Wake-up time", { exact: true }),
  ).toBeVisible();
  await expect(general.getByLabel("Screen time hours")).toBeVisible();
  await expect(
    general.getByRole("group", { name: "Used cannabis?" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("What did you actually do today?"),
  ).toBeVisible();
  await expect(
    page.getByText("A MOMENT TO REFLECT", { exact: true }),
  ).toHaveCount(0);
  await answer(page, "Meal 1", "No").click();
  await page
    .getByRole("textbox", { name: "Meal 1 reason" })
    .fill("Example reason");
  await food.getByRole("button", { name: "Minimize", exact: true }).click();
  await answer(page, "Meal 2", "Yes").click();
  await page
    .getByRole("textbox", { name: "Meal 2 food description" })
    .fill("Example food");
  await food.getByRole("button", { name: "Minimize", exact: true }).click();
  await answer(page, "Used cannabis?", "Yes").click();
  await page
    .getByRole("textbox", { name: "Cannabis use 1 description" })
    .fill("Example use");
  await general.getByRole("button", { name: "Minimize", exact: true }).click();
  for (const title of blockOrder)
    await page
      .getByRole("button", { name: `Minimize ${title}`, exact: true })
      .click();
  await expect(page.locator(".save-state")).toContainText(
    "Saved on this device",
  );
  await page.reload();
  for (const title of blockOrder)
    await expect(
      page.getByRole("button", { name: `Maximize ${title}`, exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  await page.close();
  const reopened = await context.newPage();
  await preview(reopened);
  for (const title of blockOrder)
    await expect(
      reopened.getByRole("button", { name: `Maximize ${title}`, exact: true }),
    ).toBeVisible();
  await reopened.getByRole("button", { name: "Previous day" }).click();
  for (const title of blockOrder.filter((title) => title !== "School"))
    await expect(
      reopened.getByRole("button", { name: `Maximize ${title}`, exact: true }),
    ).toBeVisible();
  await reopened.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    reopened.getByRole("button", { name: "Maximize School", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  for (const title of blockOrder)
    await reopened
      .getByRole("button", { name: `Maximize ${title}`, exact: true })
      .click();
  await expect(answer(reopened, "Attended class", "Yes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    answer(reopened, "Applied to jobs or internships?", "Yes"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    reopened.getByLabel("How many applications?", { exact: true }),
  ).toHaveText("2");
  await expect(
    reopened.getByRole("textbox", {
      name: /Meal [12] (reason|food description)/,
    }),
  ).toHaveCount(0);
  await expect(
    reopened.getByRole("textbox", { name: "Cannabis use 1 description" }),
  ).toHaveCount(0);
  await reopened
    .getByRole("button", { name: "View reason", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "View food description", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "View use descriptions", exact: true })
    .click();
  await expect(
    reopened.getByRole("textbox", { name: "Meal 1 reason" }),
  ).toHaveValue("Example reason");
  await expect(
    reopened.getByRole("textbox", { name: "Meal 2 food description" }),
  ).toHaveValue("Example food");
  await expect(
    reopened.getByRole("textbox", { name: "Cannabis use 1 description" }),
  ).toHaveValue("Example use");
  await reopened.reload();
  await expect(
    reopened.getByRole("textbox", { name: "Meal 1 reason" }),
  ).toHaveValue("Example reason");
});
test("swipes stop at today and Day 1, and ignore journal input gestures", async ({
  page,
}) => {
  await preview(page);
  async function swipe(selector: string, dx: number) {
    await page.locator(selector).evaluate((element, offset) => {
      const start = new Touch({
        identifier: 1,
        target: element,
        clientX: 200,
        clientY: 100,
      });
      const end = new Touch({
        identifier: 1,
        target: element,
        clientX: 200 + offset,
        clientY: 102,
      });
      element.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          changedTouches: [start],
        }),
      );
      element.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
      );
    }, dx);
  }
  await swipe(".day-header", -120);
  await expect(page.getByRole("heading", { name: "Day 4." })).toBeVisible();
  await swipe(".day-header", 120);
  await expect(page.getByRole("heading", { name: "Day 3." })).toBeVisible();
  await swipe("#journal", 120);
  await expect(page.getByRole("heading", { name: "Day 3." })).toBeVisible();
  await swipe(".day-header", 120);
  await swipe(".day-header", 120);
  await expect(page.getByRole("heading", { name: "Day 1." })).toBeVisible();
  await swipe(".day-header", 120);
  await expect(page.getByRole("heading", { name: "Day 1." })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous day" }),
  ).toBeDisabled();
});
