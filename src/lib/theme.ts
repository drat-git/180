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
export function useTheme() {
  const [theme, setState] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      const value = event.newValue === "dark" ? "dark" : "light";
      applyTheme(value);
      setState(value);
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  function setTheme(next: Theme) {
    applyTheme(next);
    setState(next);
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
