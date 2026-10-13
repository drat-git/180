import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
export function Appearance({ preview = false }: { preview?: boolean }) {
  const { theme, setTheme, error } = useTheme(preview);
  return (
    <section className="settings-section" aria-labelledby="appearance-title">
      <h3 id="appearance-title">Appearance</h3>
      <div className="appearance-options" role="group" aria-label="Appearance">
        <button
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
        >
          <Sun size={17} />
          Light
        </button>
        <button
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
        >
          <Moon size={17} />
          Dark
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
