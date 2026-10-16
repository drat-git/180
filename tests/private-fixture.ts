import {
  legacyAccountProfile,
  accountProfileKey,
} from "../src/lib/accountProfile";
import { expect, type Page } from "@playwright/test";

// Exercise the unchanged private UI using its existing offline unlock. This
// fixture is browser-test code only; it neither signs in nor contacts an account.
export async function openPrivateApp(page: Page) {
  await page.route("**/*.supabase.co/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".login-card, .screen-nav").first()).toBeVisible();
  await page.evaluate(
    async ({ profile, profileKey }) => {
      sessionStorage.removeItem("180-preview");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("180-private");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("meta", "readwrite");
        transaction.objectStore("meta").put({
          key: "active-account",
          value: JSON.stringify({
            id: "local-preview",
            email: "owner@example.test",
          }),
        });
        transaction
          .objectStore("meta")
          .put({ key: profileKey, value: JSON.stringify(profile) });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      profile: legacyAccountProfile("local-preview"),
      profileKey: accountProfileKey("local-preview"),
    },
  );
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
}
