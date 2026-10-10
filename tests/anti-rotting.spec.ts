import { test, expect, type Page } from "@playwright/test";
async function preview(page: Page, time = "2026-10-10T12:00:00-04:00") {
  await page.clock.install({ time: new Date(time) });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the local preview" }).click();
  await page.getByRole("button", { name: "Do Stuff", exact: true }).click();
}
async function add(page: Page, title: string, type = "reusable", notes = "") {
  await page.getByRole("button", { name: "Add activity", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Activity title", exact: true })
    .fill(title);
  await page
    .getByRole("textbox", { name: "Activity notes", exact: true })
    .fill(notes);
  await page.getByLabel("Activity type", { exact: true }).selectOption(type);
  await page
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function edit(
  page: Page,
  title: string,
  newTitle: string,
  type = "reusable",
  notes = "",
) {
  await page
    .getByRole("group", { name: `Activity ${title}`, exact: true })
    .press("Shift+F10");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Activity title", exact: true })
    .fill(newTitle);
  await page
    .getByRole("textbox", { name: "Activity notes", exact: true })
    .fill(notes);
  await page.getByLabel("Activity type", { exact: true }).selectOption(type);
  await page
    .getByRole("button", { name: "Save activity", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function remove(page: Page, title: string) {
  await page
    .getByRole("group", { name: `Activity ${title}`, exact: true })
    .press("Shift+F10");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete activity", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("reusable ideas, notes and logging persist offline without a separate daily list", async ({
  page,
  context,
}) => {
  await preview(page);
  await add(
    page,
    "Play basketball",
    "reusable",
    "Bring the ball\nGo to the park",
  );
  await page.getByRole("button", { name: "View notes", exact: true }).click();
  await expect(
    page.getByText("Bring the ball\nGo to the park", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Did this: Play basketball", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Remove today’s log for Play basketball",
      exact: true,
    }),
  ).toHaveText("Did today");
  await expect(
    page.getByRole("region", { name: "Anti Rotting did today", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hide notes", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Do Stuff", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Remove today’s log for Play basketball",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove today’s log for Play basketball",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Anti Rotting did today", exact: true }),
  ).toHaveCount(0);
});
test("one-time completion undo removes only automatic logging and resets archive timer", async ({
  page,
}) => {
  await preview(page);
  await add(page, "Watch documentary", "one-time");
  const complete = page.getByRole("checkbox", {
    name: "Complete activity Watch documentary",
    exact: true,
  });
  await complete.check();
  await expect(
    page.getByRole("button", {
      name: "Remove today’s log for Watch documentary",
      exact: true,
    }),
  ).toBeVisible();
  await complete.uncheck();
  await expect(
    page.getByRole("button", {
      name: "Did this: Watch documentary",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Did this: Watch documentary", exact: true })
    .click();
  await complete.check();
  await complete.uncheck();
  await expect(
    page.getByRole("button", {
      name: "Remove today’s log for Watch documentary",
      exact: true,
    }),
  ).toBeVisible();
  await complete.check();
  await page.clock.fastForward("11:00:00");
  await complete.uncheck();
  await complete.check();
  await page.clock.fastForward("02:00:00");
  await expect(complete).toBeVisible();
  await page.clock.fastForward("10:00:00");
  await expect(complete).toHaveCount(0);
});
test("past-day recap appears at 2 AM, is read-only, and survives rename and deletion", async ({
  page,
}, info) => {
  await preview(page, "2026-10-11T01:00:00-04:00");
  await add(page, "Read a book", "reusable", "Chapter five");
  await add(page, "Watch saved documentary", "one-time", "A film about space");
  await page
    .getByRole("button", { name: "Did this: Read a book", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Complete activity Watch saved documentary",
      exact: true,
    })
    .check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/180-anti-rotting-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Show daily check-in" }).click();
  const totals = await page
    .getByLabel("Daily checklist progress", { exact: true })
    .textContent();
  await expect(
    page.getByRole("list", { name: "Anti Rotting recap", exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward("01:00:01");
  const recap = page.getByRole("list", {
    name: "Anti Rotting recap",
    exact: true,
  });
  await expect(recap).toBeVisible();
  await expect(recap.getByText("Read a book", { exact: true })).toBeVisible();
  await expect(recap.getByText("Worked on", { exact: true })).toHaveCount(1);
  await expect(recap.getByText("Completed", { exact: true })).toHaveCount(1);
  await expect(recap.getByRole("checkbox")).toHaveCount(0);
  await expect(recap.getByRole("button")).toHaveCount(0);
  await expect(
    page.getByLabel("Daily checklist progress", { exact: true }),
  ).toHaveText(totals!);
  await page.getByRole("button", { name: "Do Stuff", exact: true }).click();
  await edit(
    page,
    "Read a book",
    "Read something else",
    "reusable",
    "Different notes",
  );
  await remove(page, "Read something else");
  await page
    .getByRole("checkbox", {
      name: "Complete activity Watch saved documentary",
      exact: true,
    })
    .uncheck();
  await remove(page, "Watch saved documentary");
  await page.getByRole("button", { name: "Show daily check-in" }).click();
  await expect(recap.getByText("Read a book", { exact: true })).toBeVisible();
  await expect(recap.getByText("Chapter five", { exact: true })).toBeVisible();
  await expect(recap.getByText("Completed", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `artifacts/180-anti-rotting-recap-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(recap).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(recap).toBeVisible();
  await page.reload();
  await expect(recap).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(recap).toBeVisible();
});
test("same-day completion undo gives worked-on recap only for manually logged items", async ({
  page,
}) => {
  await preview(page, "2026-10-11T01:00:00-04:00");
  await add(page, "Manual work", "one-time");
  await add(page, "Automatic work", "one-time");
  await page
    .getByRole("button", { name: "Did this: Manual work", exact: true })
    .click();
  for (const title of ["Manual work", "Automatic work"]) {
    const checkbox = page.getByRole("checkbox", {
      name: `Complete activity ${title}`,
      exact: true,
    });
    await checkbox.check();
    await checkbox.uncheck();
  }
  await page.clock.fastForward("01:00:01");
  await page.getByRole("button", { name: "Show daily check-in" }).click();
  const recap = page.getByRole("list", {
    name: "Anti Rotting recap",
    exact: true,
  });
  await expect(recap.getByText("Manual work", { exact: true })).toBeVisible();
  await expect(recap.getByText("Worked on", { exact: true })).toBeVisible();
  await expect(recap.getByText("Automatic work", { exact: true })).toHaveCount(
    0,
  );
  await expect(recap.getByText("Completed", { exact: true })).toHaveCount(0);
});
test("deleted ideas retain historical logs and notes can be edited", async ({
  page,
}) => {
  await preview(page, "2026-10-11T01:00:00-04:00");
  await add(page, "Explore a topic");
  await edit(
    page,
    "Explore a topic",
    "Explore astronomy",
    "reusable",
    "Read about stars",
  );
  await page
    .getByRole("button", { name: "Did this: Explore astronomy", exact: true })
    .click();
  await remove(page, "Explore astronomy");
  await expect(
    page.getByRole("group", {
      name: "Activity Explore astronomy",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Anti Rotting did today", exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward("01:00:01");
  await page.getByRole("button", { name: "Show daily check-in" }).click();
  const recap = page.getByRole("list", {
    name: "Anti Rotting recap",
    exact: true,
  });
  await expect(
    recap.getByText("Explore astronomy", { exact: true }),
  ).toBeVisible();
  await expect(
    recap.getByText("Read about stars", { exact: true }),
  ).toBeVisible();
});
test("converting a completed one-time idea to reusable reopens it and removes same-day automatic log", async ({
  page,
}) => {
  await preview(page);
  await add(page, "Walk somewhere new", "one-time");
  await page
    .getByRole("checkbox", {
      name: "Complete activity Walk somewhere new",
      exact: true,
    })
    .check();
  await edit(page, "Walk somewhere new", "Walk somewhere new", "reusable");
  await expect(
    page.getByRole("checkbox", {
      name: "Complete activity Walk somewhere new",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Did this: Walk somewhere new",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Anti Rotting did today", exact: true }),
  ).toHaveCount(0);
});

test("holding an activity opens options and moving cancels the hold", async ({
  page,
}) => {
  await preview(page);
  await add(page, "Go outside");
  const row = page.getByText("Go outside", { exact: true });
  const box = await row.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await page.mouse.down();
  await page.clock.fastForward(600);
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "Activity options" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await page.mouse.down();
  await page.mouse.move(box!.x + 30, box!.y + 4);
  await page.clock.fastForward(600);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("one-time activities precede reusable ideas, including after completion and type changes", async ({
  page,
}) => {
  await preview(page);
  await add(page, "Go for a walk");
  await add(page, "Visit the museum", "one-time");
  await add(page, "Listen to music");
  await add(page, "Watch a film", "one-time");
  const titles = page.locator(".anti-list .task-title");
  await expect(titles).toHaveText([
    "Visit the museum",
    "Watch a film",
    "Go for a walk",
    "Listen to music",
  ]);
  await page
    .getByRole("checkbox", {
      name: "Complete activity Visit the museum",
      exact: true,
    })
    .check();
  await expect(titles).toHaveText([
    "Watch a film",
    "Visit the museum",
    "Go for a walk",
    "Listen to music",
  ]);
  await edit(page, "Listen to music", "Listen to music", "one-time");
  await expect(titles).toHaveText([
    "Listen to music",
    "Watch a film",
    "Visit the museum",
    "Go for a walk",
  ]);
  await expect(page.locator(".anti-row .small")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Activity options for/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Anti Rotting did today", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-block="Anti Rotting"]')).toHaveCSS(
    "background-color",
    "rgb(243, 239, 248)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
