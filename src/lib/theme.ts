import { useEffect, useState } from "react";

export const appearanceChoices = {
  mode: ["light", "dark"],
  appPalette: ["classic", "monochrome", "blue-slate"],
  antiPalette: ["classic", "sunset", "rosewood"],
  completionPalette: ["classic", "forest-rust", "indigo-amber"],
} as const;
export type AppearancePreferences = {
  [K in keyof typeof appearanceChoices]: (typeof appearanceChoices)[K][number];
};
export type Theme = AppearancePreferences["mode"];
export const THEME_KEY = "180:theme";
export const APPEARANCE_KEYS = {
  mode: THEME_KEY,
  appPalette: "180:app-palette",
  antiPalette: "180:anti-palette",
  completionPalette: "180:completion-palette",
} as const;
export const DEMO_APPEARANCE_KEY = "180:demo-appearance";
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  mode: "light",
  appPalette: "classic",
  antiPalette: "classic",
  completionPalette: "classic",
};
export const DEMO_APPEARANCE: AppearancePreferences = {
  ...DEFAULT_APPEARANCE,
  mode: "dark",
};
export const APP_BACKGROUNDS = {
  classic: { light: "#f6f4ec", dark: "#292f2c" },
  monochrome: { light: "#f5f5f5", dark: "#272727" },
  "blue-slate": { light: "#edf2f8", dark: "#202b39" },
} as const;

export function validateAppearance(
  value: unknown,
  fallback = DEFAULT_APPEARANCE,
): AppearancePreferences {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(appearanceChoices).map(([key, options]) => [
      key,
      (options as readonly unknown[]).includes(source[key])
        ? source[key]
        : fallback[key as keyof AppearancePreferences],
    ]),
  ) as AppearancePreferences;
}
function storedAppearance(preview: boolean) {
  if (preview) {
    try {
      return validateAppearance(
        JSON.parse(
          window.sessionStorage.getItem(DEMO_APPEARANCE_KEY) || "null",
        ),
        DEMO_APPEARANCE,
      );
    } catch {
      return { ...DEMO_APPEARANCE };
    }
  }
  const values: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(APPEARANCE_KEYS)) {
    try {
      values[field] = localStorage.getItem(key);
    } catch {
      /* Storage is optional. */
    }
  }
  return validateAppearance(values);
}
export function currentAppearance(): AppearancePreferences {
  const root = document.documentElement.dataset;
  return validateAppearance({
    mode: root.theme,
    appPalette: root.appPalette,
    antiPalette: root.antiPalette,
    completionPalette: root.completionPalette,
  });
}
export function applyAppearance(preferences: AppearancePreferences) {
  const next = validateAppearance(preferences);
  const root = document.documentElement;
  root.dataset.theme = next.mode;
  root.dataset.appPalette = next.appPalette;
  root.dataset.antiPalette = next.antiPalette;
  root.dataset.completionPalette = next.completionPalette;
  root.style.colorScheme = next.mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", APP_BACKGROUNDS[next.appPalette][next.mode]);
}
export function restorePrivateTheme() {
  applyAppearance(storedAppearance(false));
}
export function restoreDemoAppearance() {
  applyAppearance(storedAppearance(true));
}
export function resetDemoAppearance() {
  try {
    window.sessionStorage.removeItem(DEMO_APPEARANCE_KEY);
  } catch {
    /* Reset still applies in memory. */
  }
  applyAppearance(DEMO_APPEARANCE);
}

export function useAppearance(preview = false) {
  const [appearance, setState] = useState(currentAppearance);
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    const update = (event: StorageEvent) => {
      if (
        event.key !== null &&
        !Object.values(APPEARANCE_KEYS).some((key) => key === event.key)
      )
        return;
      const next = storedAppearance(false);
      applyAppearance(next);
      setState(next);
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [preview]);
  function setAppearance<K extends keyof AppearancePreferences>(
    field: K,
    value: AppearancePreferences[K],
  ) {
    const next = validateAppearance({ ...currentAppearance(), [field]: value });
    applyAppearance(next);
    setState(next);
    try {
      if (preview)
        window.sessionStorage.setItem(
          DEMO_APPEARANCE_KEY,
          JSON.stringify(next),
        );
      else localStorage.setItem(APPEARANCE_KEYS[field], next[field]);
      setError("");
    } catch {
      setError(
        "Your appearance changed, but couldn’t be remembered on this device.",
      );
    }
  }
  return { appearance, setAppearance, error };
}
