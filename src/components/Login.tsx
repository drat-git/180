import { useState, type FormEvent } from "react";
import { ArrowRight, ArrowLeft, ShieldCheck } from "lucide-react";
import { supabase, configured } from "../lib/supabase";
export function Login({
  onPreview,
  recovery,
  onRecovered,
  initialError = "",
}: {
  onPreview: () => void;
  recovery: boolean;
  onRecovered: () => void;
  initialError?: string;
}) {
  const [email, setEmail] = useState("dratgit@gmail.com"),
    [password, setPassword] = useState(""),
    [reset, setReset] = useState(false),
    [setup, setSetup] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(initialError),
    [error, setError] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      if (!configured)
        throw new Error(
          "Cloud setup is not configured yet. You can try the local preview.",
        );
      if (recovery) {
        if (password.length < 8)
          throw new Error("Use a password with at least 8 characters.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        history.replaceState({}, "", "/");
        onRecovered();
      } else if (reset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/update-password`,
        });
        if (error) throw error;
        setMessage("Check your email for a password reset link.");
      } else if (setup) {
        if (email.toLowerCase() !== "dratgit@gmail.com")
          throw new Error("This app is private to dratgit@gmail.com.");
        if (password.length < 8) throw new Error("Use at least 8 characters.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin },
        });
        if (error) throw error;
        if (!data.session)
          setMessage(
            "Your account is created. Confirm the link in your email, then sign in.",
          );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="wordmark">
        180<span>ONE DAY AT A TIME</span>
      </div>
      <div className="login-card">
        <span className="eyebrow">YOUR DAILY RECORD</span>
        <h1>
          {recovery
            ? "Make it yours."
            : reset
              ? "A fresh start."
              : setup
                ? "Your first day."
                : "A little honesty.\nEvery day."}
        </h1>
        <p>
          {recovery
            ? "Set a password for your private account."
            : reset
              ? "We’ll send a link to reset your password."
              : setup
                ? "Create your private account with dratgit@gmail.com."
                : "A quiet place to record what you did, and how the day felt."}
        </p>
        <form onSubmit={submit}>
          {!recovery && (
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {(!reset || recovery) && (
            <label>
              {recovery ? "New password" : "Password"}
              <input
                type="password"
                autoComplete={
                  recovery || setup ? "new-password" : "current-password"
                }
                value={password}
                required
                minLength={recovery || setup ? 8 : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy} type="submit">
            {busy
              ? "One moment…"
              : recovery
                ? "Set password"
                : reset
                  ? "Send reset link"
                  : setup
                    ? "Create private account"
                    : "Sign in"}
            <ArrowRight size={17} />
          </button>
          {message && (
            <p role="status" className={error ? "error" : "notice"}>
              {message}
            </p>
          )}
        </form>
        {!recovery && (
          <button
            className="text-button login-switch"
            onClick={() => {
              setReset(!reset);
              setSetup(false);
              setMessage("");
            }}
          >
            {reset ? (
              <>
                <ArrowLeft size={14} />
                Back to sign in
              </>
            ) : (
              "Forgot your password?"
            )}
          </button>
        )}
        {!recovery && !reset && (
          <button
            className="text-button login-switch"
            onClick={() => {
              setSetup(!setup);
              setMessage("");
            }}
          >
            {setup
              ? "Already set up? Sign in"
              : "First time? Set up your private account"}
          </button>
        )}
        <div className="login-divider" />
        <button className="preview-link" onClick={onPreview}>
          Try the local preview <ArrowRight size={16} />
        </button>
        <p className="small">
          Preview entries stay on this device, separate from your account.
        </p>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={15} />
        Private. Personal. Yours.
      </div>
    </main>
  );
}
