import { useEffect, useState } from "react";
export type Theme = "light" | "dark";
export const THEME_KEY = "180:theme";
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#292f2c" : "#f6f4ec");
}
export function restorePrivateTheme() {
  try {
    applyTheme(localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
  } catch {
    applyTheme("light");
  }
}
export function useTheme(preview = false) {
  const [theme, setState] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    const update = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      const value = event.newValue === "dark" ? "dark" : "light";
      applyTheme(value);
      setState(value);
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [preview]);
  function setTheme(next: Theme) {
    applyTheme(next);
    setState(next);
    if (preview) return;
    try {
      localStorage.setItem(THEME_KEY, next);
      setError("");
    } catch {
      setError(
        "Your appearance changed, but couldn’t be remembered on this device.",
      );
    }
  }
  return { theme, setTheme, error };
}
