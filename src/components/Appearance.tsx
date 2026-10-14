import { Check, Moon, Sun } from "lucide-react";
import { useAppearance } from "../lib/theme";

const palettes = {
  appPalette: {
    label: "App theme",
    options: [
      { value: "monochrome", label: "Monochrome" },
      { value: "blue-slate", label: "Blue Slate" },
      { value: "classic", label: "Classic" },
    ],
  },
  antiPalette: {
    label: "Anti-rot colors",
    options: [
      { value: "sunset", label: "Sunset" },
      { value: "rosewood", label: "Rosewood" },
      { value: "classic", label: "Classic" },
    ],
  },
  completionPalette: {
    label: "Completion colors",
    options: [
      { value: "forest-rust", label: "Forest & Rust" },
      { value: "indigo-amber", label: "Indigo & Amber" },
      { value: "classic", label: "Classic" },
    ],
  },
} as const;
export function Appearance({ preview = false }: { preview?: boolean }) {
  const { appearance, setAppearance, error } = useAppearance(preview);
  return (
    <section
      className="settings-section appearance-settings"
      aria-labelledby="appearance-title"
    >
      <h3 id="appearance-title">Appearance</h3>
      <fieldset className="appearance-group">
        <legend>Mode</legend>
        <div className="appearance-options">
          {(["light", "dark"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={appearance.mode === mode}
              onClick={() => setAppearance("mode", mode)}
            >
              {mode === "light" ? (
                <Sun size={17} aria-hidden="true" />
              ) : (
                <Moon size={17} aria-hidden="true" />
              )}
              {mode === "light" ? "Light" : "Dark"}
              {appearance.mode === mode && (
                <Check
                  size={14}
                  aria-hidden="true"
                  className="appearance-check"
                />
              )}
            </button>
          ))}
        </div>
      </fieldset>
      {(Object.keys(palettes) as (keyof typeof palettes)[]).map((field) => (
        <fieldset key={field} className="appearance-group">
          <legend>{palettes[field].label}</legend>
          <div className="appearance-options palette-options">
            {palettes[field].options.map((option) => (
              <button
                key={option.value}
                type="button"
                data-palette={option.value}
                aria-pressed={appearance[field] === option.value}
                onClick={() => setAppearance(field, option.value)}
              >
                <span
                  aria-hidden="true"
                  className="appearance-swatch"
                  data-layer={field}
                  data-swatch={option.value}
                />
                {option.label}
                {appearance[field] === option.value && (
                  <Check
                    size={14}
                    aria-hidden="true"
                    className="appearance-check"
                  />
                )}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
