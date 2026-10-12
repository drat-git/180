import { useEffect, useState } from "react";
import { supabase } from "./supabase";
const INSTALLATION_KEY = "180:push-installation";
export interface ReminderConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  publicKey: string;
  installationId?: string;
}
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function installationId() {
  let id = localStorage.getItem(INSTALLATION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, id);
  }
  return id;
}
export function notificationSupport() {
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "Notifications aren’t supported in this browser. Open the installed iPhone app.";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (
    ios &&
    !matchMedia("(display-mode: standalone)").matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  )
    return "On iPhone, use Share → Add to Home Screen, then enable reminders from that app.";
  if (Notification.permission === "denied")
    return "Notifications are blocked. Allow them for 180 in your device’s notification settings.";
  return "";
}
async function request(
  action: string,
  id: string,
  extra: Record<string, unknown> = {},
): Promise<ReminderConfig> {
  if (!navigator.onLine)
    throw new Error("Connect to the internet to change reminders.");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in again to manage reminders.");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);
  let response;
  try {
    response = await supabase.functions.invoke("push-settings", {
      body: { action, installationId: id, ...extra },
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const { data, error } = response;
  if (error || data?.error)
    throw new Error(
      data?.error ||
        "Couldn’t save reminder settings. Check your connection and try again.",
    );
  return data as ReminderConfig;
}
function publicKeyBytes(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
}
export function useNotifications(userId: string, preview: boolean) {
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [id, setId] = useState(() => {
    try {
      return preview ? "" : installationId();
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (preview || !id) return;
    let active = true;
    const refresh = async () => {
      if (!navigator.onLine) {
        if (active)
          setError("Connect to the internet to load reminder settings.");
        return;
      }
      try {
        let next = await request("config", id);
        if (next.enabled && next.timezone !== timezone())
          next = await request("update", id, {
            time: next.time,
            timezone: timezone(),
          });
        if (active) {
          setConfig(next);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [userId, preview, id, refreshKey]);
  async function change(
    action: "enable" | "disable" | "update" | "test",
    time = config?.time ?? "21:00",
  ) {
    if (busy || preview) return;
    setBusy(true);
    setError("");
    setMessage("");
    let created: PushSubscription | null = null;
    try {
      if (!navigator.onLine)
        throw new Error("Connect to the internet to change reminders.");
      if (!id)
        throw new Error(
          "Allow device storage to remember this app’s notification settings.",
        );
      if (action === "enable") {
        if (!config)
          throw new Error(
            "Load reminder settings before enabling notifications.",
          );
        const support = notificationSupport();
        if (support) throw new Error(support);
        // This call must be made directly from the Enable button's user gesture.
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error(
            "Reminders weren’t enabled. You can allow notifications in device settings.",
          );
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: publicKeyBytes(config.publicKey),
          }));
        if (!existing) created = subscription;
        const next = await request("subscribe", id, {
          subscription: subscription.toJSON(),
          origin: location.origin,
          time,
          timezone: timezone(),
        });
        setConfig(next);
        if (next.installationId && next.installationId !== id) {
          try {
            localStorage.setItem(INSTALLATION_KEY, next.installationId);
          } catch {
            /* The canonical ID can be recovered from this subscription again. */
          }
          setId(next.installationId);
        }
      } else {
        setConfig(
          await request(action === "disable" ? "unsubscribe" : action, id, {
            time,
            timezone: timezone(),
          }),
        );
        if (action === "disable") {
          const registration = await navigator.serviceWorker.ready;
          await (
            await registration.pushManager.getSubscription()
          )?.unsubscribe();
        }
      }
      setMessage(
        action === "test"
          ? "Test notification sent. Check your notifications."
          : action === "disable"
            ? "Reminders are off for this app."
            : "Reminder settings saved.",
      );
    } catch (e) {
      if (created) await created.unsubscribe().catch(() => false);
      setError(e instanceof Error ? e.message : "Couldn’t update reminders.");
    } finally {
      setBusy(false);
    }
  }
  return {
    config,
    busy,
    error,
    message,
    change,
    retry: () => setRefreshKey((key) => key + 1),
    support: preview ? "" : notificationSupport(),
  };
}
export async function disableInstallation() {
  try {
    const id = localStorage.getItem(INSTALLATION_KEY);
    if (id && navigator.onLine) await request("unsubscribe", id);
  } catch {
    /* Browser unsubscription also stops delivery if offline. */
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* An expired registration is already unable to receive pushes. */
  }
}
