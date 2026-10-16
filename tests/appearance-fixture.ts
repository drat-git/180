import type { Page } from "@playwright/test";

export async function expandAppearance(page: Page) {
  await page
    .getByRole("dialog", { name: "Your space", exact: true })
    .locator(".appearance-settings > summary")
    .click();
}
