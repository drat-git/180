import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import fs from "node:fs";
import {
  APPEARANCE_KEYS,
  APP_BACKGROUNDS,
  DEFAULT_APPEARANCE,
  DEMO_APPEARANCE,
  DEMO_APPEARANCE_KEY,
  applyAppearance,
  currentAppearance,
  resetDemoAppearance,
  restoreDemoAppearance,
  restorePrivateTheme,
  useAppearance,
  validateAppearance,
} from "./theme";

beforeEach(() => {
  window.sessionStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#f6f4ec">';
  applyAppearance(DEFAULT_APPEARANCE);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});
it("restores legacy mode and defaults each absent/invalid palette independently", () => {
  localStorage.setItem("180:theme", "dark");
  localStorage.setItem(APPEARANCE_KEYS.appPalette, "blue-slate");
  localStorage.setItem(APPEARANCE_KEYS.antiPalette, "garbage");
  restorePrivateTheme();
  expect(currentAppearance()).toEqual({
    ...DEFAULT_APPEARANCE,
    mode: "dark",
    appPalette: "blue-slate",
  });
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.querySelector("meta")!.content).toBe(
    APP_BACKGROUNDS["blue-slate"].dark,
  );
  expect(
    validateAppearance({
      mode: "system",
      appPalette: null,
      antiPalette: ["sunset"],
      completionPalette: "forest-rust",
    }),
  ).toEqual({ ...DEFAULT_APPEARANCE, completionPalette: "forest-rust" });
});
it("keeps all four settings independent across all 54 combinations", () => {
  let count = 0;
  for (const mode of ["light", "dark"] as const)
    for (const appPalette of ["classic", "monochrome", "blue-slate"] as const)
      for (const antiPalette of ["classic", "sunset", "rosewood"] as const)
        for (const completionPalette of [
          "classic",
          "forest-rust",
          "indigo-amber",
        ] as const) {
          const next = { mode, appPalette, antiPalette, completionPalette };
          applyAppearance(next);
          expect(currentAppearance()).toEqual(next);
          expect(document.querySelector("meta")!.content).toBe(
            APP_BACKGROUNDS[appPalette][mode],
          );
          count++;
        }
  expect(count).toBe(54);
});
it("persists private changes immediately while retaining other choices", () => {
  const { result } = renderHook(() => useAppearance());
  act(() => result.current.setAppearance("appPalette", "monochrome"));
  act(() => result.current.setAppearance("antiPalette", "sunset"));
  act(() => result.current.setAppearance("completionPalette", "forest-rust"));
  act(() => result.current.setAppearance("mode", "dark"));
  applyAppearance(DEFAULT_APPEARANCE);
  restorePrivateTheme();
  expect(currentAppearance()).toEqual(result.current.appearance);
  expect(window.sessionStorage.getItem(DEMO_APPEARANCE_KEY)).toBeNull();
});
it("retains demo choices on reload, resets them, and restores every private preference on exit", () => {
  const privateValues = {
    mode: "light",
    appPalette: "blue-slate",
    antiPalette: "rosewood",
    completionPalette: "indigo-amber",
  } as const;
  for (const [field, key] of Object.entries(APPEARANCE_KEYS))
    localStorage.setItem(
      key,
      privateValues[field as keyof typeof privateValues],
    );
  resetDemoAppearance();
  const { result } = renderHook(() => useAppearance(true));
  act(() => result.current.setAppearance("mode", "light"));
  act(() => result.current.setAppearance("appPalette", "monochrome"));
  act(() => result.current.setAppearance("antiPalette", "sunset"));
  act(() => result.current.setAppearance("completionPalette", "forest-rust"));
  restoreDemoAppearance();
  expect(currentAppearance()).toEqual(result.current.appearance);
  restorePrivateTheme();
  expect(currentAppearance()).toEqual(privateValues);
  resetDemoAppearance();
  expect(currentAppearance()).toEqual(DEMO_APPEARANCE);
  expect(window.sessionStorage.getItem(DEMO_APPEARANCE_KEY)).toBeNull();
  restorePrivateTheme();
  expect(currentAppearance()).toEqual(privateValues);
});
it("handles malformed demo JSON and denied storage reads without losing usable defaults", () => {
  window.sessionStorage.setItem(DEMO_APPEARANCE_KEY, "{bad");
  restoreDemoAppearance();
  expect(currentAppearance()).toEqual(DEMO_APPEARANCE);
  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  restorePrivateTheme();
  expect(currentAppearance()).toEqual(DEFAULT_APPEARANCE);
  restoreDemoAppearance();
  expect(currentAppearance()).toEqual(DEMO_APPEARANCE);
});
it.each([false, true])(
  "keeps changes usable and reports unavailable storage (demo=%s)",
  (preview) => {
    const { result } = renderHook(() => useAppearance(preview));
    if (preview)
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new Error("denied");
      });
    else
      vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
    act(() => result.current.setAppearance("antiPalette", "sunset"));
    expect(currentAppearance().antiPalette).toBe("sunset");
    expect(result.current.error).toContain("couldn’t be remembered");
  },
);
it("reconciles valid private storage events and ignores them in demo", () => {
  const privateHook = renderHook(() => useAppearance());
  localStorage.setItem(APPEARANCE_KEYS.antiPalette, "rosewood");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: APPEARANCE_KEYS.antiPalette }),
    ),
  );
  expect(privateHook.result.current.appearance.antiPalette).toBe("rosewood");
  privateHook.unmount();
  resetDemoAppearance();
  const demoHook = renderHook(() => useAppearance(true));
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: APPEARANCE_KEYS.antiPalette }),
    ),
  );
  expect(demoHook.result.current.appearance).toEqual(DEMO_APPEARANCE);
});
it("the synchronous head bootstrap matches the runtime model before React, including invalid or denied storage", () => {
  const script = fs
    .readFileSync("index.html", "utf8")
    .match(/<script>([\s\S]*?)<\/script>/)![1];
  const bootstrap = () => new Function(script)();
  for (const mode of ["light", "dark"] as const)
    for (const appPalette of ["classic", "monochrome", "blue-slate"] as const) {
      localStorage.setItem("180:theme", mode);
      localStorage.setItem(APPEARANCE_KEYS.appPalette, appPalette);
      localStorage.setItem(APPEARANCE_KEYS.antiPalette, "rosewood");
      localStorage.setItem(APPEARANCE_KEYS.completionPalette, "indigo-amber");
      bootstrap();
      const initial = currentAppearance();
      const metadata = document.querySelector("meta")!.content;
      restorePrivateTheme();
      expect(currentAppearance()).toEqual(initial);
      expect(document.querySelector("meta")!.content).toBe(metadata);
    }
  window.sessionStorage.setItem("180-preview", "true");
  window.sessionStorage.setItem(
    DEMO_APPEARANCE_KEY,
    JSON.stringify({
      ...DEMO_APPEARANCE,
      appPalette: "monochrome",
      antiPalette: "sunset",
    }),
  );
  bootstrap();
  const demo = currentAppearance();
  restoreDemoAppearance();
  expect(currentAppearance()).toEqual(demo);
  window.sessionStorage.setItem(DEMO_APPEARANCE_KEY, "{bad");
  bootstrap();
  expect(currentAppearance()).toEqual(DEMO_APPEARANCE);
  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(bootstrap).not.toThrow();
  expect(currentAppearance()).toEqual(DEFAULT_APPEARANCE);
});
