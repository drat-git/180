import { useEffect, useState } from "react";
import type { useNotifications } from "../lib/notifications";
export function NotificationSettings({
  controller,
  preview,
}: {
  controller: ReturnType<typeof useNotifications>;
  preview: boolean;
}) {
  const { config, busy, error, message, change, sendDemoTest, retry, support } =
    controller;
  const [time, setTime] = useState(config?.time ?? "21:00");
  useEffect(() => {
    if (config) setTime(config.time);
  }, [config?.time]);
  return (
    <section className="settings-section" aria-labelledby="notifications-title">
      <h3 id="notifications-title">Daily reminders</h3>
      {preview ? (
        <>
          <p className="small">
            Try a reminder on this device—no account needed. Your browser will
            ask for notification permission.
          </p>
          {support && <p className="small">{support}</p>}
          <div className="notification-controls">
            <button
              className="primary"
              disabled={busy || !!support}
              onClick={() => void sendDemoTest()}
            >
              {busy ? "Sending…" : "Send demo notification"}
            </button>
          </div>
          <p className="small">
            This sends one test notification. Sign in to enable scheduled daily
            reminders.
          </p>
        </>
      ) : (
        <>
          <p className="small">
            One reminder every day, even after you’ve filled out your checklist.
          </p>
          <p className="small" role="status">
            {config
              ? config.enabled
                ? "On for this app"
                : "Off for this app"
              : error
                ? "Settings unavailable"
                : "Loading reminder settings…"}
          </p>
          {support && <p className="small">{support}</p>}
          <div className="notification-controls">
            <label htmlFor="reminder-time">Reminder time</label>
            <input
              id="reminder-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={busy || !config}
            />
            <button
              className="primary"
              disabled={
                busy || !config || (!config.enabled && !!support) || !time
              }
              onClick={() =>
                void change(config?.enabled ? "disable" : "enable", time)
              }
            >
              {config?.enabled ? "Disable reminders" : "Enable reminders"}
            </button>
            {config?.enabled && (
              <>
                {time !== config.time && (
                  <button
                    disabled={busy || !time}
                    onClick={() => void change("update", time)}
                  >
                    Save time
                  </button>
                )}
                <button disabled={busy} onClick={() => void change("test")}>
                  Send test notification
                </button>
              </>
            )}
          </div>
          <p className="small">
            {config?.timezone ??
              Intl.DateTimeFormat().resolvedOptions().timeZone}{" "}
            · Times follow this device when you reopen the app after travel.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!preview && error && !config && (
        <button className="text-button" onClick={retry}>
          Retry reminder settings
        </button>
      )}
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
    </section>
  );
}
