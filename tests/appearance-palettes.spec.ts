import { expect, test, type Page } from "@playwright/test";
import { openPrivateApp } from "./private-fixture";

const root = (page: Page) => page.locator("html");
const space = (page: Page) =>
  page.getByRole("dialog", { name: "Your space", exact: true });
const openSpace = (page: Page) =>
  page.getByRole("button", { name: "Account and app information" }).click();
const closeSpace = (page: Page) =>
  space(page)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
async function choose(page: Page, group: string, name: string) {
  const button = space(page)
    .getByRole("group", { name: group, exact: true })
    .getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
async function open(page: Page) {
  await page.clock.install({ time: new Date("2026-10-14T12:00:00-04:00") });
  await openPrivateApp(page);
}
async function dataSnapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("180-private");
      r.onsuccess = () => resolve(r.result);
    });
    const names = [
      "entries",
      "tasks",
      "taskEvents",
      "antiItems",
      "antiLogs",
      "antiEvents",
      "outbox",
    ];
    const result = await Promise.all(
      names.map(
        (name) =>
          new Promise((resolve) => {
            const r = db.transaction(name).objectStore(name).getAll();
            r.onsuccess = () => resolve(r.result);
          }),
      ),
    );
    db.close();
    return result;
  });
}
async function expectPalettes(
  page: Page,
  mode: string,
  app: string,
  anti: string,
  completion: string,
) {
  await expect(root(page)).toHaveAttribute("data-theme", mode);
  await expect(root(page)).toHaveAttribute("data-app-palette", app);
  await expect(root(page)).toHaveAttribute("data-anti-palette", anti);
  await expect(root(page)).toHaveAttribute(
    "data-completion-palette",
    completion,
  );
}

test("all 54 combinations resolve independent layers, neutral unanswered controls and accessible completion colors", async ({
  page,
}) => {
  await open(page);
  const answer = (label: string, value: string) =>
    page
      .getByRole("group", { name: label, exact: true })
      .getByRole("button", { name: value, exact: true });
  await answer("AM posture exercises", "Yes").click();
  await answer("Used cannabis?", "No").click();
  await answer("Applied to jobs or internships?", "No").click();
  await page.locator("#wake").fill("08:00");
  await page
    .getByRole("spinbutton", { name: "Screen time hours", exact: true })
    .fill("5");
  const samples = await page.evaluate(() => {
    const motion = document.createElement("style");
    motion.textContent =
      "*, *::before, *::after { transition: none !important; animation: none !important; }";
    document.head.append(motion);
    const html = document.documentElement;
    const complete = document.querySelector<HTMLButtonElement>(
      '[aria-label="AM posture exercises"] button.selected',
    )!;
    const incomplete = document.querySelector<HTMLButtonElement>(
      '[aria-label="Applied to jobs or internships?"] button.selected',
    )!;
    const noComplete = document.querySelector<HTMLButtonElement>(
      '[aria-label="Used cannabis?"] button.selected',
    )!;
    const anti = document.querySelector(
      '[data-block="Things to do instead of scrolling"]',
    )!;
    const color = (value: string) => {
      const el = document.createElement("span");
      el.style.color = value;
      document.body.append(el);
      const result = getComputedStyle(el).color;
      el.remove();
      return result;
    };
    const required = [
      "--app-background",
      "--app-card",
      "--app-input",
      "--app-soft",
      "--app-selected",
      "--app-hover",
      "--app-text",
      "--app-heading",
      "--app-muted",
      "--app-border",
      "--app-input-border",
      "--app-accent",
      "--app-accent-fill",
      "--app-accent-hover",
      "--app-on-accent",
      "--app-focus",
      "--app-focus-ring",
      "--app-shadow",
      "--app-overlay",
      "--app-translucent-card",
      "--app-history-ink",
      "--app-icon-tint",
      "--anti-surface",
      "--anti-tint",
      "--anti-border",
      "--anti-heading",
      "--anti-text",
      "--anti-muted",
      "--anti-control-ink",
      "--anti-control-surface",
      "--anti-focus",
      "--anti-check",
      "--anti-completed-surface",
      "--anti-selected-ink",
      "--anti-selected-border",
      "--completion-complete",
      "--completion-incomplete",
      "--completion-complete-border",
      "--completion-incomplete-border",
      "--priority-background",
      "--priority-ink",
      "--priority-accent",
    ];
    const result = [];
    for (const mode of ["light", "dark"])
      for (const app of ["classic", "monochrome", "blue-slate"])
        for (const antiPalette of ["classic", "sunset", "rosewood"])
          for (const completion of ["classic", "forest-rust", "indigo-amber"]) {
            Object.assign(html.dataset, {
              theme: mode,
              appPalette: app,
              antiPalette,
              completionPalette: completion,
            });
            html.style.colorScheme = mode;
            const style = getComputedStyle(html);
            result.push({
              mode,
              app,
              antiPalette,
              completion,
              background: style.backgroundColor,
              text: style.color,
              anti: getComputedStyle(anti).backgroundColor,
              antiHeading: getComputedStyle(anti.querySelector("h3")!).color,
              complete: getComputedStyle(complete).backgroundColor,
              incomplete: getComputedStyle(incomplete).backgroundColor,
              icon: getComputedStyle(complete).color,
              noComplete: getComputedStyle(noComplete).backgroundColor,
              completeBorder: getComputedStyle(document.querySelector("#wake")!)
                .borderBottomColor,
              incompleteBorder: getComputedStyle(
                document.querySelector("#screen-hours")!,
              ).borderBottomColor,
              card: color(style.getPropertyValue("--app-card")),
              neutral: getComputedStyle(
                document.querySelector(
                  '[aria-label="PM posture exercises"] button',
                )!,
              ).backgroundColor,
              missing: required.filter(
                (name) => !style.getPropertyValue(name).trim(),
              ),
            });
          }
    return result;
  });
  const rgb = (hex: string) =>
    `rgb(${hex
      .match(/\w\w/g)!
      .map((n) => parseInt(n, 16))
      .join(", ")})`;
  const backgrounds = {
    classic: ["f6f4ec", "292f2c"],
    monochrome: ["f5f5f5", "272727"],
    "blue-slate": ["edf2f8", "202b39"],
  };
  const antis = {
    classic: ["f3eff8", "383440"],
    sunset: ["fbefe5", "403128"],
    rosewood: ["f6e9eb", "3e2d34"],
  };
  const fills = {
    classic: [
      ["187d95", "9a5a82"],
      ["287f94", "975579"],
    ],
    "forest-rust": [
      ["2d7557", "b34f46"],
      ["357b60", "b2544c"],
    ],
    "indigo-amber": [
      ["a1651e", "5357ad"],
      ["9b6520", "6064b5"],
    ],
  };
  const luminance = (c: string) =>
    c
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => n / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) /
    (Math.min(luminance(a), luminance(b)) + 0.05);
  expect(samples).toHaveLength(54);
  for (const sample of samples) {
    const n = sample.mode === "dark" ? 1 : 0;
    expect(sample.missing, JSON.stringify(sample)).toEqual([]);
    expect(sample.background).toBe(
      rgb(backgrounds[sample.app as keyof typeof backgrounds][n]),
    );
    expect(sample.anti).toBe(
      rgb(antis[sample.antiPalette as keyof typeof antis][n]),
    );
    const colors = fills[sample.completion as keyof typeof fills][n];
    expect(sample.complete).toBe(rgb(colors[0]));
    expect(sample.noComplete).toBe(sample.complete);
    expect(sample.incomplete).toBe(rgb(colors[1]));
    expect(sample.neutral).toBe("rgba(0, 0, 0, 0)");
    if (sample.app === "monochrome")
      expect(new Set(sample.text.match(/\d+/g)).size).toBe(1);
    if (sample.completion !== "classic") {
      expect(sample.icon).toBe("rgb(255, 255, 255)");
      expect(contrast(sample.icon, sample.complete)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(sample.icon, sample.incomplete)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(sample.completeBorder, sample.card),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(sample.incompleteBorder, sample.card),
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

for (const [app, anti, completion] of [
  ["Monochrome", "Sunset", "Forest & Rust"],
  ["Blue Slate", "Rosewood", "Indigo & Amber"],
]) {
  test(`mixed dark ${app} and ${anti} preserves drafts, saved answers and task history`, async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "To-do", exact: true }).click();
    await page
      .getByRole("textbox", { name: "New school task", exact: true })
      .fill("Important essay");
    await page
      .getByRole("button", { name: "Add school task", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "High priority", exact: true })
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add task", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "New school task", exact: true })
      .fill("Completed task");
    await page
      .getByRole("button", { name: "Add school task", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add task", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Complete Completed task", exact: true })
      .check();
    await expect(
      page.locator('[aria-label="Task Completed task"]'),
    ).toHaveClass(/is-complete/);
    await page
      .getByRole("textbox", { name: "New school task", exact: true })
      .fill("Keep this draft");
    await page.getByRole("button", { name: "Anti-rot", exact: true }).click();
    await page
      .getByRole("button", { name: "Add activity", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Activity title", exact: true })
      .fill("Read a chapter");
    await page
      .getByRole("textbox", { name: "Activity notes", exact: true })
      .fill("Bring a book");
    await page
      .getByRole("combobox", { name: "Activity type", exact: true })
      .selectOption("one-time");
    await page
      .getByRole("button", { name: "Save activity", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Complete activity Read a chapter",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "View notes", exact: true }).click();
    await expect(page.getByText("Bring a book", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "To-do", exact: true }).click();
    const before = await dataSnapshot(page);
    await openSpace(page);
    for (const group of [
      "Mode",
      "App theme",
      "Anti-rot colors",
      "Completion colors",
    ])
      await expect(
        space(page).getByRole("group", { name: group, exact: true }),
      ).toBeVisible();
    await choose(page, "Mode", "Dark");
    await choose(page, "App theme", app);
    await choose(page, "Anti-rot colors", anti);
    await choose(page, "Completion colors", completion);
    await space(page)
      .getByRole("heading", { name: "Appearance", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/private-screenshots/180-appearance-${app.toLowerCase().replace(" ", "-")}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await closeSpace(page);
    await expect(
      page.getByRole("textbox", { name: "New school task", exact: true }),
    ).toHaveValue("Keep this draft");
    expect(await dataSnapshot(page)).toEqual(before);
    await page.screenshot({
      path: `test-results/private-screenshots/180-palette-tasks-${app.toLowerCase().replace(" ", "-")}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Anti-rot", exact: true }).click();
    await page.screenshot({
      path: `test-results/private-screenshots/180-palette-anti-${anti.toLowerCase()}-${test.info().project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.clock.fastForward("24:00:01");
    await page
      .getByRole("button", { name: "Show daily checklist", exact: true })
      .click();
    const recap = page.getByRole("list", {
      name: "Daily activity recap",
      exact: true,
    });
    await expect(recap).toContainText("Read a chapter");
    await expect(recap).toContainText("Completed");
    await expect(recap.locator(".small")).toHaveText("Bring a book");
    await recap.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/private-screenshots/180-palette-recap-${anti.toLowerCase()}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

test("legacy and invalid stored choices restore before first render; all preferences survive offline reload", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("appearance-initialized")) {
      localStorage.setItem("180:theme", "dark");
      localStorage.setItem("180:app-palette", "invalid");
      localStorage.setItem("180:anti-palette", "rosewood");
      localStorage.setItem("180:completion-palette", "invalid");
      sessionStorage.setItem("appearance-initialized", "true");
    }
    (window as unknown as { firstAppearance: unknown }).firstAppearance = null;
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".loading, .login-card, .app-shell")) return;
      (window as unknown as { firstAppearance: unknown }).firstAppearance = {
        ...document.documentElement.dataset,
      };
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await open(page);
  await expectPalettes(page, "dark", "classic", "rosewood", "classic");
  expect(
    await page.evaluate(
      () => (window as unknown as { firstAppearance: unknown }).firstAppearance,
    ),
  ).toMatchObject({
    theme: "dark",
    appPalette: "classic",
    antiPalette: "rosewood",
    completionPalette: "classic",
  });
  await openSpace(page);
  await choose(page, "App theme", "Monochrome");
  await choose(page, "Anti-rot colors", "Sunset");
  await choose(page, "Completion colors", "Forest & Rust");
  await closeSpace(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expectPalettes(page, "dark", "monochrome", "sunset", "forest-rust");
  expect(
    await page.evaluate(
      () => (window as unknown as { firstAppearance: unknown }).firstAppearance,
    ),
  ).toMatchObject({
    theme: "dark",
    appPalette: "monochrome",
    antiPalette: "sunset",
    completionPalette: "forest-rust",
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#272727",
  );
  await openSpace(page);
  await expect(
    space(page).getByRole("button", { name: "Forest & Rust", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("demo palettes stay session-local, survive reload, reset to dark Classic and restore every private choice on exit", async ({
  page,
}) => {
  await open(page);
  await openSpace(page);
  await choose(page, "App theme", "Blue Slate");
  await choose(page, "Anti-rot colors", "Rosewood");
  await choose(page, "Completion colors", "Indigo & Amber");
  await space(page)
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await page.getByRole("button", { name: "Try the demo mode" }).click();
  await expectPalettes(page, "dark", "classic", "classic", "classic");
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await openSpace(page);
  await choose(page, "Mode", "Light");
  await choose(page, "App theme", "Monochrome");
  await choose(page, "Anti-rot colors", "Sunset");
  await choose(page, "Completion colors", "Forest & Rust");
  await closeSpace(page);
  expect(
    await page.evaluate(() => [
      localStorage.getItem("180:app-palette"),
      localStorage.getItem("180:anti-palette"),
      localStorage.getItem("180:completion-palette"),
    ]),
  ).toEqual(["blue-slate", "rosewood", "indigo-amber"]);
  await page.reload();
  await expectPalettes(page, "light", "monochrome", "sunset", "forest-rust");
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await expectPalettes(page, "dark", "classic", "classic", "classic");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectPalettes(page, "light", "blue-slate", "rosewood", "indigo-amber");
});

test("storage failure keeps controls usable and explains that the preference could not be remembered", async ({
  page,
}) => {
  await open(page);
  await openSpace(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("180:")) throw new Error("Storage denied");
      original.call(this, key, value);
    };
  });
  await choose(page, "App theme", "Blue Slate");
  await expect(
    space(page).locator(".appearance-settings").getByRole("alert"),
  ).toContainText("couldn’t be remembered");
  await expect(root(page)).toHaveAttribute("data-app-palette", "blue-slate");
  await choose(page, "Mode", "Dark");
  await expect(root(page)).toHaveAttribute("data-theme", "dark");
});
