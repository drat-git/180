import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const DisplayContext = createContext({
  userId: "local-preview",
  onError: (_message: string) => {},
});
export function DisplayPreferencesProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  return (
    <DisplayContext.Provider value={{ userId, onError: setError }}>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {children}
    </DisplayContext.Provider>
  );
}

// Display choices belong to the account on this browser, across dates and visits.
// They are separate from daily records and do not enqueue cloud edits.
export function useMinimized(control: string, fallback = false) {
  const { userId, onError } = useContext(DisplayContext);
  const key = `180:display:${encodeURIComponent(userId)}:${control}`;
  function read() {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "minimized";
    } catch {
      return fallback;
    }
  }
  const [minimized, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener("storage", update);
    window.addEventListener("180-display-change", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("180-display-change", update);
    };
  }, [key]);
  function setMinimized(next: boolean) {
    setState(next);
    try {
      window.localStorage.setItem(key, next ? "minimized" : "expanded");
      onError("");
      window.dispatchEvent(new Event("180-display-change"));
    } catch {
      onError(
        "Could not remember display preferences. This change may reset when you reopen the app.",
      );
    }
  }
  return [minimized, setMinimized] as const;
}
