import { expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  invoke: vi.fn(),
  permission: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: mock.session },
    functions: { invoke: mock.invoke },
  },
}));
import { useNotifications } from "./notifications";
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
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
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
