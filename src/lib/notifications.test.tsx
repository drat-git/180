import { expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  invoke: vi.fn(),
  permission: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  showNotification: vi.fn(),
  registration: vi.fn(),
}));
vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: mock.session },
    functions: { invoke: mock.invoke },
  },
}));
import { demoNotificationSupport, useNotifications } from "./notifications";
const config = {
  enabled: false,
  time: "21:00",
  timezone: "America/New_York",
  publicKey: "BA" + "A".repeat(85),
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({
    data: { session: { user: { id: "owner" } } },
  });
  mock.invoke.mockResolvedValue({ data: config, error: null });
  mock.permission.mockResolvedValue("granted");
  mock.showNotification.mockResolvedValue(undefined);
  mock.registration.mockResolvedValue({
    active: { state: "activated" },
    showNotification: mock.showNotification,
  });
  mock.unsubscribe.mockResolvedValue(true);
  mock.subscribe.mockResolvedValue({
    toJSON: () => ({
      endpoint: "https://web.push.apple.com/test",
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    }),
    unsubscribe: mock.unsubscribe,
  });
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: mock.permission,
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "ServiceWorkerRegistration",
    class {
      showNotification = mock.showNotification;
    },
  );
  ServiceWorkerRegistration.prototype.showNotification = mock.showNotification;
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistration: mock.registration,
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => null,
          subscribe: mock.subscribe,
        },
      }),
    },
    configurable: true,
  });
});
it("preview never creates a subscription or calls the production backend", async () => {
  const { result } = renderHook(() => useNotifications("local-preview", true));
  await act(async () => {
    await result.current.change("enable");
  });
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(mock.permission).not.toHaveBeenCalled();
});
it("sends a local demo notification offline without auth, subscriptions or private settings", async () => {
  const before = localStorage.getItem("180:push-installation");
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  // Local notifications do not require the Push API.
  vi.stubGlobal("PushManager", undefined);
  const { result } = renderHook(() =>
    useNotifications("local-demo:test", true),
  );
  expect(mock.permission).not.toHaveBeenCalled();
  let sending: Promise<void>;
  act(() => {
    sending = result.current.sendDemoTest();
    expect(mock.permission).toHaveBeenCalledOnce();
  });
  await act(async () => {
    await sending;
  });
  expect(mock.showNotification).toHaveBeenCalledWith("180 demo reminder", {
    body: "Take a moment to record your day. This is a demo notification.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "180-demo-checklist",
    data: { url: "/?view=today" },
  });
  expect(mock.session).not.toHaveBeenCalled();
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(mock.subscribe).not.toHaveBeenCalled();
  expect(mock.unsubscribe).not.toHaveBeenCalled();
  expect(localStorage.getItem("180:push-installation")).toBe(before);
  expect(result.current.config).toBeNull();
  expect(result.current.message).toContain("Demo notification sent");
});
it("reuses existing notification permission without prompting again", async () => {
  Object.defineProperty(Notification, "permission", { value: "granted" });
  const { result } = renderHook(() =>
    useNotifications("local-demo:test", true),
  );
  await act(async () => {
    await result.current.sendDemoTest();
  });
  expect(mock.permission).not.toHaveBeenCalled();
  expect(mock.showNotification).toHaveBeenCalledOnce();
});
it.each(["denied", "default"])(
  "does not send a demo notification when the permission response is %s",
  async (permission) => {
    mock.permission.mockResolvedValueOnce(permission);
    const { result } = renderHook(() =>
      useNotifications("local-demo:test", true),
    );
    await act(async () => {
      await result.current.sendDemoTest();
    });
    expect(mock.registration).not.toHaveBeenCalled();
    expect(mock.showNotification).not.toHaveBeenCalled();
    expect(result.current.error).toContain("No notification was sent");
    expect(result.current.message).toBe("");
    expect(result.current.busy).toBe(false);
  },
);
it("explains blocked demo notifications without asking permission again", async () => {
  Object.defineProperty(Notification, "permission", { value: "denied" });
  const { result } = renderHook(() =>
    useNotifications("local-demo:test", true),
  );
  expect(result.current.support).toContain("Notifications are blocked");
  await act(async () => {
    await result.current.sendDemoTest();
  });
  expect(mock.permission).not.toHaveBeenCalled();
  expect(mock.showNotification).not.toHaveBeenCalled();
});
it("handles an unready demo service worker and allows another attempt", async () => {
  mock.registration.mockResolvedValueOnce(undefined);
  const { result } = renderHook(() =>
    useNotifications("local-demo:test", true),
  );
  await act(async () => {
    await result.current.sendDemoTest();
  });
  expect(result.current.error).toContain("still getting ready");
  expect(mock.showNotification).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.sendDemoTest();
  });
  expect(result.current.error).toBe("");
  expect(mock.showNotification).toHaveBeenCalledOnce();
});
it("reports local notification failures without claiming success", async () => {
  mock.showNotification.mockRejectedValueOnce(
    new Error("Notifications unavailable"),
  );
  const { result } = renderHook(() =>
    useNotifications("local-demo:test", true),
  );
  await act(async () => {
    await result.current.sendDemoTest();
  });
  expect(result.current.error).toBe("Notifications unavailable");
  expect(result.current.message).toBe("");
  expect(result.current.busy).toBe(false);
});
it("requires a supported secure context for demo notifications", () => {
  vi.stubGlobal("isSecureContext", false);
  expect(demoNotificationSupport()).toContain(
    "can’t show device notifications",
  );
});
it("permission denial never subscribes or marks reminders enabled", async () => {
  mock.permission.mockResolvedValueOnce("denied");
  const { result } = renderHook(() => useNotifications("owner", false));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  await act(async () => {
    await result.current.change("enable");
  });
  expect(mock.subscribe).not.toHaveBeenCalled();
  expect(result.current.config?.enabled).toBe(false);
  expect(result.current.error).toContain("weren’t enabled");
});
it("a server registration failure removes the orphan subscription and stays off", async () => {
  const { result } = renderHook(() => useNotifications("owner", false));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  mock.invoke.mockResolvedValueOnce({
    data: null,
    error: new Error("Offline"),
  });
  await act(async () => {
    await result.current.change("enable");
  });
  expect(mock.unsubscribe).toHaveBeenCalledOnce();
  expect(result.current.config?.enabled).toBe(false);
  expect(result.current.error).toContain("Couldn’t save");
});
it("an offline settings change does not pretend it was saved", async () => {
  const { result } = renderHook(() => useNotifications("owner", false));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  await act(async () => {
    await result.current.change("update", "22:00");
  });
  expect(result.current.config?.time).toBe("21:00");
  expect(result.current.error).toContain("Connect");
});
it("reuses the server installation when device preferences were cleared", async () => {
  const canonicalId = "6dab8a30-07cb-4f5a-8f2e-fd153b3e0f25";
  let subscribed = false;
  mock.invoke.mockImplementation(async (_name, { body }) => {
    if (body.action === "subscribe") subscribed = true;
    return {
      data: {
        ...config,
        enabled: subscribed,
        installationId: subscribed ? canonicalId : undefined,
      },
      error: null,
    };
  });
  const { result } = renderHook(() => useNotifications("owner", false));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  await act(async () => {
    await result.current.change("enable");
  });
  expect(localStorage.getItem("180:push-installation")).toBe(canonicalId);
  expect(result.current.config?.enabled).toBe(true);
  expect(mock.unsubscribe).not.toHaveBeenCalled();
});
it("failed settings loading can be retried without reloading the app", async () => {
  mock.invoke.mockResolvedValueOnce({
    data: null,
    error: new Error("Network"),
  });
  const { result } = renderHook(() => useNotifications("owner", false));
  await waitFor(() => expect(result.current.error).toContain("Couldn’t save"));
  await act(async () => {
    result.current.retry();
  });
  await waitFor(() => expect(result.current.config?.time).toBe("21:00"));
  expect(result.current.error).toBe("");
});
