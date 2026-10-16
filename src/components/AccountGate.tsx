import { useEffect, useState, type ReactNode } from "react";
import type { AccountProfile } from "../lib/accountProfile";
import { cachedAccountProfile, fetchAccountProfile } from "../lib/accounts";
import { Onboarding } from "./Onboarding";

export function AccountGate({
  userId,
  onSignOut,
  children,
}: {
  userId: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<AccountProfile>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await cachedAccountProfile(userId);
      if (active && cached) setProfile(cached);
      try {
        const current = await fetchAccountProfile(userId);
        if (active) {
          setProfile(current);
          setError("");
        }
      } catch {
        if (active && !cached)
          setError(
            "Connect and sign in to finish loading your account. Your saved records are kept on this device.",
          );
      }
    })().catch(
      () =>
        active &&
        setError("Could not load your account on this device. Try again."),
    );
    const reconnect = () => setAttempt((value) => value + 1);
    window.addEventListener("online", reconnect);
    return () => {
      active = false;
      window.removeEventListener("online", reconnect);
    };
  }, [userId, attempt]);
  if (!profile)
    return (
      <main className="loading">
        <span className="wordmark">180</span>
        <p role="status">{error || "Opening your space…"}</p>
        {error && (
          <>
            <button
              className="primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
            <button className="text-button" onClick={onSignOut}>
              Back to sign in
            </button>
          </>
        )}
      </main>
    );
  if (!profile.onboardingCompletedAt)
    return (
      <Onboarding
        userId={userId}
        onComplete={setProfile}
        onSignOut={onSignOut}
      />
    );
  return children;
}
