import { expect, test, type Page } from "@playwright/test";
import {
  starterTemplates,
  selectedStarterConfiguration,
  type OnboardingSelection,
} from "../src/lib/starters";
import { emptyConfiguration } from "../src/lib/accountProfile";
import type { Tables } from "../src/lib/database.types";

const id = "80000000-0000-4000-8000-000000000001";
const stamp = "2026-10-15T16:00:00.000Z";
async function publicBackend(
  page: Page,
  options: { failOnce?: boolean; startDate?: string } = {},
) {
  const profile: Tables<"account_profiles"> = {
    user_id: id,
    created_at: stamp,
    signup_timezone: "America/New_York",
    start_date: options.startDate ?? "2026-10-15",
    legacy: false,
    onboarding_completed_at: null,
    starter_id: null,
    starter_version: null,
    initial_configuration: emptyConfiguration() as never,
  };
  const posts: OnboardingSelection[] = [];
  let tasks: unknown[] = [],
    anti: unknown[] = [],
    answers: Record<string, unknown>[] = [];
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: "starter@example.test",
    email_confirmed_at: stamp,
    created_at: stamp,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  };
  const jwt =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: id, role: "authenticated", exp: 1893456000 },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join(".") + ".fixture";
  await page.clock.install({ time: new Date(stamp) });
  await page.addInitScript(() => {
    localStorage.setItem("180:theme", "dark");
    localStorage.setItem("180:app-palette", "classic");
    localStorage.setItem("180:completion-palette", "forest-rust");
    localStorage.setItem("180:anti-palette", "classic");
  });
  await page.route("**/*.supabase.co/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/auth/v1/signup") || path.endsWith("/auth/v1/token")) {
      return respond({
        access_token: jwt,
        refresh_token: "fixture-refresh",
        token_type: "bearer",
        expires_in: 86400,
        expires_at: 1893456000,
        user,
      });
    }
    if (path.endsWith("/auth/v1/user")) return respond(user);
    if (path.endsWith("/auth/v1/logout")) return respond({});
    if (path.endsWith("/rest/v1/account_profiles")) return respond(profile);
    if (path.endsWith("/rpc/complete_onboarding")) {
      const body = route.request().postDataJSON();
      const selection = {
        operationId: body.p_operation,
        starterId: body.p_starter,
        version: body.p_version,
        ...body.p_selection,
      } as OnboardingSelection;
      posts.push(selection);
      if (options.failOnce && posts.length === 1)
        return respond({ message: "Connection interrupted" }, 503);
      if (!profile.onboarding_completed_at) {
        const template = starterTemplates.find(
          (entry) => entry.id === selection.starterId,
        )!;
        profile.initial_configuration = selectedStarterConfiguration(
          template,
          selection,
        ) as never;
        profile.onboarding_completed_at = stamp;
        profile.starter_id = template.id;
        profile.starter_version = template.version;
        tasks = template.tasks
          .filter((task) => selection.tasks.includes(task.id))
          .map((task, index) => ({
            id: `80000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
            user_id: id,
            topic: task.listId,
            parent_id: null,
            title: task.title,
            completed_at: null,
            deleted_at: null,
            estimated_minutes: null,
            high_priority: false,
            due_date: null,
            due_at: null,
            revision: 0,
            created_at: stamp,
            updated_at: stamp,
          }));
        anti = template.activities
          .filter((activity) => selection.activities.includes(activity.id))
          .map((activity, index) => ({
            data: {
              id: `80000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
              userId: id,
              title: activity.title,
              notes: "",
              itemType: activity.itemType,
              completedAt: null,
              deletedAt: null,
              completionOperationId: null,
              revision: 0,
              createdAt: stamp,
              updatedAt: stamp,
            },
          }));
      }
      return respond(profile);
    }
    if (path.endsWith("/rpc/apply_custom_answer_operation")) {
      const body = route.request().postDataJSON();
      const result = {
        user_id: id,
        logical_date: body.p_logical_date,
        item_id: body.p_item_id,
        generation: body.p_generation,
        value: {
          generation: body.p_generation,
          value: null,
          fields: {},
          selections: [],
          ...body.p_patch,
        },
        revision: 1,
        created_at: stamp,
        updated_at: stamp,
      };
      answers = [result];
      return respond(result);
    }
    if (path.endsWith("/rest/v1/tasks")) return respond(tasks);
    if (path.endsWith("/rest/v1/anti_rotting_items")) return respond(anti);
    if (path.endsWith("/rest/v1/custom_answers")) return respond(answers);
    if (path.includes("/functions/v1/"))
      return respond({
        enabled: false,
        time: "21:00",
        timezone: "America/New_York",
        publicKey: "B".repeat(87),
      });
    return respond([]);
  });
  return { profile, posts };
}
async function signup(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Forgot/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("starter@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-password-only");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find your starting point." }),
  ).toBeVisible();
}
for (const title of ["Everyday", "Student", "Work & projects"]) {
  test(`${title} creates only selected content on Day 1`, async ({ page }) => {
    const backend = await publicBackend(page);
    await signup(page);
    await page
      .getByRole("button", { name: new RegExp(title.replace("&", "\\&")) })
      .click();
    await expect(
      page.getByRole("heading", { name: "Make it yours." }),
    ).toBeFocused();
    await expect(page.getByRole("checkbox")).toHaveCount(17);
    await page.getByRole("button", { name: "Start using 180" }).click();
    await expect(
      page.getByRole("heading", { name: "Day 1", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Daily checklist progress", { exact: true }),
    ).toHaveText("0/6 checks complete");
    expect(backend.posts).toHaveLength(1);
    await page
      .getByRole("button", { name: "Account and app information" })
      .click();
    const account = page.getByRole("dialog", {
      name: "Your space",
      exact: true,
    });
    await expect(account).toContainText("Day 1: Thursday, October 15, 2026");
    await expect(account).not.toContainText("October 9");
    await account
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("button", { name: "To-do", exact: true }).click();
    await expect(page.locator(".task-row")).toHaveCount(3);
    await page.getByRole("button", { name: "Anti-rot", exact: true }).click();
    await expect(
      page.getByText("Take a short walk", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Find a new place to visit", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Creatine");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("list dependencies, Back, reload recovery, failed completion and offline use", async ({
  page,
  context,
}, info) => {
  const backend = await publicBackend(page, { failOnce: true });
  await signup(page);
  await page.getByRole("button", { name: /Student/ }).click();
  await page.getByRole("checkbox", { name: "Keep School list" }).uncheck();
  await expect(
    page.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "Keep School list" }).check();
  await expect(
    page.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: /Back to starters/ }).click();
  await page.getByRole("button", { name: /Student/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open("180-private");
          r.onsuccess = () => resolve(r.result);
        });
        const row = await new Promise<{ value: string } | undefined>(
          (resolve) => {
            const r = db
              .transaction("meta")
              .objectStore("meta")
              .get("onboarding-draft:80000000-0000-4000-8000-000000000001");
            r.onsuccess = () => resolve(r.result);
          },
        );
        db.close();
        return row ? JSON.parse(row.value).step : null;
      }),
    )
    .toBe("review");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  await page.screenshot({
    path: `artifacts/180-onboarding-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start using 180" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Start using 180" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 1", exact: true }),
  ).toBeVisible();
  expect(backend.posts[0]).toEqual(backend.posts[1]);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Day 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByText("DAY 1 · IN PROGRESS", { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
});
test("blank setup retains the account anchor after delayed onboarding and exposes creation tools", async ({
  page,
}, info) => {
  await publicBackend(page, { startDate: "2026-10-12" });
  await signup(page);
  await page.getByRole("button", { name: /Start from scratch/ }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.appPalette = "blue-slate";
    document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({
    path: `artifacts/180-onboarding-blank-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start using 180" }).click();
  await expect(
    page.getByRole("heading", { name: "Day 4", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create your checklist" }).click();
  await expect(
    page.getByRole("dialog", { name: "Customize checklist", exact: true }),
  ).toBeVisible();
});
