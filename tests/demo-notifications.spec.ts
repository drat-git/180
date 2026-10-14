import { test, expect } from "@playwright/test";

// The headless shell disables notification permission; use full Chromium.
test.use({ channel: "chromium" });

test("demo sends a real local test notification offline without an account or push subscription", async ({
  page,
  context,
}) => {
  // Model an installed app on the phone project; desktop needs no installation.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  await context.grantPermissions(["notifications"], {
    origin: "http://localhost:4173",
  });
  const backendWrites: string[] = [];
  page.on("request", (request) => {
    if (/\/rest\/v1|\/storage\/v1|\/functions\/v1/.test(request.url()))
      backendWrites.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Day 3", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  expect(await page.evaluate(() => Notification.permission)).toBe("granted");
  const originalInstallation = await page.evaluate(() =>
    localStorage.getItem("180:push-installation"),
  );
  await page
    .getByRole("button", { name: "Account and app information", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Your space",
    exact: true,
  });
  await expect(settings).toContainText("no account needed");
  await expect(
    settings.getByRole("button", { name: "Enable reminders", exact: true }),
  ).toHaveCount(0);
  await context.setOffline(true);
  await settings
    .getByRole("button", { name: "Send demo notification", exact: true })
    .click();
  await expect(settings).toContainText("Demo notification sent.");
  const notification = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration!.getNotifications({
      tag: "180-demo-checklist",
    });
    const sent = notifications.map(({ title, body, tag, data }) => ({
      title,
      body,
      tag,
      data,
    }));
    for (const notification of notifications) notification.close();
    return {
      sent,
      subscription: await registration!.pushManager.getSubscription(),
      installation: localStorage.getItem("180:push-installation"),
    };
  });
  expect(notification.sent).toEqual([
    {
      title: "180 demo reminder",
      body: "Take a moment to record your day. This is a demo notification.",
      tag: "180-demo-checklist",
      data: { url: "/?view=today" },
    },
  ]);
  expect(notification.subscription).toBeNull();
  expect(notification.installation).toBe(originalInstallation);
  expect(backendWrites).toEqual([]);
  await settings
    .getByRole("region", { name: "Daily reminders", exact: true })
    .screenshot({
      path: `test-results/demo-notification-${test.info().project.name}.png`,
    });
});

test("demo explains blocked notifications and does not send", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Account and app information", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Your space",
    exact: true,
  });
  await expect(settings).toContainText("Notifications are blocked");
  await expect(
    settings.getByRole("button", {
      name: "Send demo notification",
      exact: true,
    }),
  ).toBeDisabled();
});

test("iPhone browser demo explains the Home Screen requirement", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phone-specific installation guidance");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Account and app information", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Your space",
    exact: true,
  });
  await expect(settings).toContainText("Share → Add to Home Screen");
  await expect(
    settings.getByRole("button", {
      name: "Send demo notification",
      exact: true,
    }),
  ).toBeDisabled();
});
