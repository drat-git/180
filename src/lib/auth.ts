import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { db } from "./db";
export interface AppUser {
  id: string;
  email: string;
  cached?: boolean;
}
export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null),
    [loading, setLoading] = useState(true),
    [recovery, setRecovery] = useState(
      location.pathname === "/update-password",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (session) {
        const next = { id: session.user.id, email: session.user.email ?? "" };
        setUser(next);
        setLoading(false);
        void db.meta.put({
          key: "active-account",
          value: JSON.stringify(next),
        });
      }
      if (event === "SIGNED_OUT") {
        // A rejected refresh token also emits SIGNED_OUT. Only explicit sign-out
        // removes the local unlock; renewal failures must keep offline editing.
        void db.meta.get("active-account").then((cached) => {
          if (!active) return;
          setUser(
            cached ? { ...JSON.parse(cached.value), cached: true } : null,
          );
          setLoading(false);
        });
      }
    });
    void (async () => {
      const cached = await db.meta.get("active-account");
      if (cached && active) {
        setUser({ ...JSON.parse(cached.value), cached: true });
        setLoading(false);
      }
      const token = new URLSearchParams(location.search).get("token_hash");
      if (token && location.pathname === "/update-password") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: "recovery",
        });
        if (error && active) setError(error.message);
        history.replaceState({}, "", location.pathname);
      }
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (active) {
        if (error) setError("Sign in again when online to resume sync.");
        if (session)
          setUser({ id: session.user.id, email: session.user.email ?? "" });
        setLoading(false);
      }
    })().catch((e) => {
      if (active) {
        setError(e.message || "Could not open the account.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  async function signOut() {
    await db.meta.delete("active-account");
    setUser(null);
    await supabase.auth.signOut({ scope: "local" });
  }
  return { user, loading, recovery, setRecovery, error, signOut };
}
